import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      !/\.[^/]+$/.test(specifier) &&
      context.parentURL?.includes("/runtime/pi/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { ExtensionService, ExtensionServiceError } = (await import(
  new URL("./extension-service.ts", import.meta.url).href
)) as typeof import("./extension-service");
const { DefaultPackageManager, SettingsManager } = await import("@earendil-works/pi-coding-agent");
moduleHooks.deregister();

function extension(
  path: string,
  options: {
    hidden?: boolean;
    events?: string[];
    tools?: string[];
    commands?: string[];
    source?: string;
    scope?: "user" | "project" | "temporary";
    origin?: "package" | "top-level";
    baseDir?: string;
  } = {},
) {
  return {
    path,
    ...(options.hidden === undefined ? {} : { hidden: options.hidden }),
    sourceInfo: {
      source: options.source ?? "auto",
      scope: options.scope ?? "user",
      origin: options.origin ?? "top-level",
      ...(options.baseDir ? { baseDir: options.baseDir } : {}),
    },
    handlers: new Map((options.events ?? []).map((name) => [name, [{}]])),
    tools: new Map(
      (options.tools ?? []).map((name) => [
        name,
        {
          definition: {
            label: name,
            description: `${name} tool`,
            parameters: { type: "object" },
          },
        },
      ]),
    ),
    commands: new Map(
      (options.commands ?? []).map((name) => [name, { description: `${name} command` }]),
    ),
  };
}

test("lists visible extensions loaded by the target Pi session", async () => {
  const requestedSessionIds: string[] = [];
  const service = new ExtensionService({
    getSession: async (sessionId) => {
      requestedSessionIds.push(sessionId);
      return {
        session: {
          resourceLoader: {
            getExtensions: () => ({
              extensions: [
                extension("/home/user/.pi/agent/extensions/review.ts", {
                  events: ["tool_call", "session_start"],
                  tools: ["review_changes"],
                  commands: ["review"],
                }),
                extension("/workspace/.pi/extensions/git-tools/index.ts", {
                  source: "npm:@acme/git-tools",
                  scope: "project",
                  origin: "package",
                  tools: ["git_status"],
                }),
                extension("<inline:internal>", { hidden: true }),
              ],
              errors: [{ path: "/private/broken.ts", error: "private details" }],
            }),
          },
        },
      };
    },
  });

  assert.deepEqual(await service.list({ sessionId: "session-1" }), {
    extensions: [
      {
        name: "review",
        filePath: "/home/user/.pi/agent/extensions/review.ts",
        source: "auto",
        scope: "user",
        origin: "top-level",
        enabled: true,
        eventNames: ["session_start", "tool_call"],
        toolNames: ["review_changes"],
        commandNames: ["review"],
        eventDetails: [
          { name: "session_start", handlerCount: 1 },
          { name: "tool_call", handlerCount: 1 },
        ],
        toolDetails: [
          {
            name: "review_changes",
            label: "review_changes",
            description: "review_changes tool",
            parameterSchemaJson: `{
  "type": "object"
}`,
          },
        ],
        commandDetails: [
          {
            name: "review",
            description: "review command",
            hasArgumentCompletions: false,
          },
        ],
      },
      {
        name: "git-tools",
        filePath: "/workspace/.pi/extensions/git-tools/index.ts",
        source: "npm:@acme/git-tools",
        scope: "project",
        origin: "package",
        enabled: true,
        eventNames: [],
        toolNames: ["git_status"],
        commandNames: [],
        eventDetails: [],
        toolDetails: [
          {
            name: "git_status",
            label: "git_status",
            description: "git_status tool",
            parameterSchemaJson: `{
  "type": "object"
}`,
          },
        ],
        commandDetails: [],
      },
    ],
    loadErrorCount: 1,
  });
  assert.deepEqual(requestedSessionIds, ["session-1"]);
});

test("reads the entry file matched by the complete extension identity", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-workbench-read-extension-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const extensionFile = path.join(root, "extensions", "review.ts");
  await mkdir(path.dirname(extensionFile), { recursive: true });
  await writeFile(extensionFile, "export default function review() {}\n");
  await writeFile(
    path.join(path.dirname(extensionFile), "private.ts"),
    "export const secret = 1;\n",
  );
  const service = new ExtensionService({
    getSession: async () => ({
      session: {
        resourceLoader: {
          getExtensions: () => ({
            extensions: [extension(extensionFile)],
            errors: [],
          }),
        },
      },
    }),
  });
  const identity = {
    sessionId: "session-1",
    name: "review",
    filePath: extensionFile,
    source: "auto",
    scope: "user" as const,
    origin: "top-level" as const,
  };

  const snapshot = await service.readFile(identity);
  assert.equal(snapshot.extensionName, "review");
  assert.equal(snapshot.rootPath, path.dirname(extensionFile));
  assert.equal(snapshot.relativePath, "review.ts");
  assert.equal(snapshot.absolutePath, extensionFile);
  assert.equal(snapshot.name, "review.ts");
  assert.equal(snapshot.content, "export default function review() {}\n");
  assert.equal(snapshot.encoding, "utf-8");
  assert.match(snapshot.version, /^sha256:/);

  const listing = await service.listFiles(identity);
  assert.equal(listing.rootPath, path.dirname(extensionFile));
  assert.deepEqual(listing.entries, [
    {
      name: "review.ts",
      relativePath: "review.ts",
      kind: "file",
      hidden: false,
    },
  ]);

  await assert.rejects(
    service.readFile({ ...identity, relativePath: "private.ts" }),
    (error: unknown) => {
      assert.ok(error instanceof ExtensionServiceError);
      assert.equal(error.code, "extension-file-unreadable");
      return true;
    },
  );

  await assert.rejects(
    service.readFile({ ...identity, filePath: path.join(root, "private.txt") }),
    (error: unknown) => {
      assert.ok(error instanceof ExtensionServiceError);
      assert.equal(error.code, "extension-not-found");
      return true;
    },
  );
});

test("lists and reads files inside a directory-backed extension", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-workbench-read-extension-directory-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const extensionRoot = path.join(root, "extensions", "review");
  const extensionFile = path.join(extensionRoot, "index.ts");
  const nestedFile = path.join(extensionRoot, "lib", "prompt.ts");
  await mkdir(path.dirname(nestedFile), { recursive: true });
  await writeFile(extensionFile, "export { prompt } from './lib/prompt';\n");
  await writeFile(nestedFile, "export const prompt = 'review';\n");
  const service = new ExtensionService({
    getSession: async () => ({
      session: {
        resourceLoader: {
          getExtensions: () => ({
            extensions: [extension(extensionFile)],
            errors: [],
          }),
        },
      },
    }),
  });
  const identity = {
    sessionId: "session-1",
    name: "review",
    filePath: extensionFile,
    source: "auto",
    scope: "user" as const,
    origin: "top-level" as const,
  };

  const rootListing = await service.listFiles(identity);
  assert.equal(rootListing.rootPath, extensionRoot);
  assert.deepEqual(
    rootListing.entries.map(({ name, relativePath, kind }) => ({ name, relativePath, kind })),
    [
      { name: "lib", relativePath: "lib", kind: "directory" },
      { name: "index.ts", relativePath: "index.ts", kind: "file" },
    ],
  );

  const nestedListing = await service.listFiles({ ...identity, relativePath: "lib" });
  assert.deepEqual(nestedListing.entries, [
    {
      name: "prompt.ts",
      relativePath: "lib/prompt.ts",
      kind: "file",
      hidden: false,
    },
  ]);

  const snapshot = await service.readFile({ ...identity, relativePath: "lib/prompt.ts" });
  assert.equal(snapshot.absolutePath, nestedFile);
  assert.equal(snapshot.relativePath, "lib/prompt.ts");
  assert.equal(snapshot.content, "export const prompt = 'review';\n");
});

test("keeps disabled resolved extensions in the catalog so they can be enabled again", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-workbench-disabled-extension-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const extensionFile = path.join(cwd, ".pi", "extensions", "disabled-review.ts");
  await mkdir(path.dirname(extensionFile), { recursive: true });
  await writeFile(extensionFile, "export default function review() {}\n");
  const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true });
  settingsManager.setProjectExtensionPaths(["-extensions/disabled-review.ts"]);
  await settingsManager.flush();
  const service = new ExtensionService({
    getSession: async () => ({
      session: {
        resourceLoader: {
          getExtensions: () => ({ extensions: [], errors: [] }),
        },
        settingsManager,
        sessionManager: { getCwd: () => cwd },
      },
    }),
  });

  const disabled = (await service.list({ sessionId: "session-1" })).extensions.find(
    (candidate) => candidate.name === "disabled-review",
  );
  assert.deepEqual(disabled, {
    name: "disabled-review",
    filePath: extensionFile,
    source: "auto",
    scope: "project",
    origin: "top-level",
    enabled: false,
    eventNames: [],
    toolNames: [],
    commandNames: [],
    eventDetails: [],
    toolDetails: [],
    commandDetails: [],
  });
});

test("persists the official exact extension filter and reloads an idle session", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-workbench-toggle-extension-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const baseDir = path.join(cwd, ".pi");
  const extensionFile = path.join(baseDir, "extensions", "review.ts");
  await mkdir(path.dirname(extensionFile), { recursive: true });
  await writeFile(extensionFile, "export default function review() {}\n");
  const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true });
  let reloadCount = 0;
  const service = new ExtensionService({
    getSession: async () => ({
      isRunning: false,
      session: {
        resourceLoader: {
          getExtensions: () => ({
            extensions: [
              extension(extensionFile, {
                scope: "project",
                baseDir,
              }),
            ],
            errors: [],
          }),
        },
        settingsManager,
        sessionManager: { getCwd: () => cwd },
        reload: async () => {
          reloadCount += 1;
        },
      },
    }),
  });
  const identity = {
    sessionId: "session-1",
    name: "review",
    filePath: extensionFile,
    source: "auto",
    scope: "project" as const,
    origin: "top-level" as const,
  };

  assert.deepEqual(await service.setEnabled({ ...identity, enabled: false }), {
    name: "review",
    filePath: extensionFile,
    enabled: false,
  });
  assert.deepEqual(settingsManager.getProjectSettings().extensions, ["-extensions/review.ts"]);
  assert.equal(reloadCount, 1);

  assert.deepEqual(await service.setEnabled({ ...identity, enabled: true }), {
    name: "review",
    filePath: extensionFile,
    enabled: true,
  });
  assert.deepEqual(settingsManager.getProjectSettings().extensions, ["+extensions/review.ts"]);
  assert.equal(reloadCount, 2);
});

test("disabling a package extension also disables its bundled Pi resources", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-workbench-disable-extension-package-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const packageSource = "./review-package";
  const packageRoot = path.join(cwd, ".pi", "review-package");
  const extensionFile = path.join(packageRoot, "extension.ts");
  const skillFile = path.join(packageRoot, "skills", "review", "SKILL.md");
  const promptFile = path.join(packageRoot, "prompts", "review.md");
  const themeFile = path.join(packageRoot, "themes", "review.json");
  await mkdir(path.dirname(skillFile), { recursive: true });
  await mkdir(path.dirname(promptFile), { recursive: true });
  await mkdir(path.dirname(themeFile), { recursive: true });
  await writeFile(extensionFile, "export default function review() {}\n");
  await writeFile(skillFile, "---\nname: review\ndescription: Review changes\n---\nReview.\n");
  await writeFile(promptFile, "Review this change.\n");
  await writeFile(themeFile, "{}\n");
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: "review-package",
      version: "1.0.0",
      pi: {
        extensions: ["./extension.ts"],
        skills: ["./skills/review/SKILL.md"],
        prompts: ["./prompts/review.md"],
        themes: ["./themes/review.json"],
      },
    }),
  );
  const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true });
  settingsManager.setProjectPackages([packageSource]);
  await settingsManager.flush();
  let reloadCount = 0;
  const service = new ExtensionService({
    getSession: async () => ({
      isRunning: false,
      session: {
        resourceLoader: {
          getExtensions: () => ({
            extensions: [
              extension(extensionFile, {
                source: packageSource,
                scope: "project",
                origin: "package",
                baseDir: packageRoot,
                events: ["session_start"],
                tools: ["review_changes"],
                commands: ["review"],
              }),
            ],
            errors: [],
          }),
        },
        settingsManager,
        sessionManager: { getCwd: () => cwd },
        reload: async () => {
          reloadCount += 1;
        },
      },
    }),
  });

  assert.deepEqual(
    await service.setEnabled({
      sessionId: "session-1",
      name: "extension",
      filePath: extensionFile,
      source: packageSource,
      scope: "project",
      origin: "package",
      enabled: false,
    }),
    { name: "extension", filePath: extensionFile, enabled: false },
  );
  assert.deepEqual(settingsManager.getProjectSettings().packages, [
    {
      source: packageSource,
      extensions: ["-extension.ts"],
      skills: ["-skills/review/SKILL.md"],
      prompts: ["-prompts/review.md"],
      themes: ["-themes/review.json"],
    },
  ]);
  assert.equal(reloadCount, 1);

  const resolved = await new DefaultPackageManager({
    cwd,
    agentDir: path.join(cwd, "agent"),
    settingsManager,
  }).resolve(async () => "skip");
  assert.equal(
    resolved.extensions.find(({ path: value }) => value === extensionFile)?.enabled,
    false,
  );
  assert.equal(resolved.skills.find(({ path: value }) => value === skillFile)?.enabled, false);
  assert.equal(resolved.prompts.find(({ path: value }) => value === promptFile)?.enabled, false);
  assert.equal(resolved.themes.find(({ path: value }) => value === themeFile)?.enabled, false);
});

test("deletes only an automatically discovered independent extension root", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-workbench-remove-extension-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const baseDir = path.join(cwd, ".pi");
  const extensionDirectory = path.join(baseDir, "extensions", "remove-me");
  const extensionFile = path.join(extensionDirectory, "index.ts");
  await mkdir(extensionDirectory, { recursive: true });
  await writeFile(extensionFile, "export default function removeMe() {}\n");
  let reloadCount = 0;
  const service = new ExtensionService({
    getSession: async () => ({
      isRunning: false,
      session: {
        resourceLoader: {
          getExtensions: () => ({
            extensions: [
              extension(extensionFile, {
                scope: "project",
                baseDir,
              }),
            ],
            errors: [],
          }),
        },
        sessionManager: { getCwd: () => cwd },
        reload: async () => {
          reloadCount += 1;
        },
      },
    }),
  });

  assert.deepEqual(
    await service.remove({
      sessionId: "session-1",
      name: "remove-me",
      filePath: extensionFile,
      source: "auto",
      scope: "project",
      origin: "top-level",
    }),
    { name: "remove-me", filePath: extensionFile, removed: true },
  );
  await assert.rejects(stat(extensionDirectory), { code: "ENOENT" });
  assert.equal(reloadCount, 1);
});

test("rejects a caller-controlled removal path that is not the resolved extension identity", async () => {
  let removeCalled = false;
  const extensionFile = "/home/user/.pi/agent/extensions/review.ts";
  const service = new ExtensionService({
    getSession: async () => ({
      session: {
        resourceLoader: {
          getExtensions: () => ({
            extensions: [extension(extensionFile, { baseDir: "/home/user/.pi/agent" })],
            errors: [],
          }),
        },
      },
    }),
    removeExtensionPath: async () => {
      removeCalled = true;
    },
  });

  await assert.rejects(
    service.remove({
      sessionId: "session-1",
      name: "review",
      filePath: "/home/user/private.txt",
      source: "auto",
      scope: "user",
      origin: "top-level",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ExtensionServiceError);
      assert.equal(error.code, "extension-not-found");
      return true;
    },
  );
  assert.equal(removeCalled, false);
});

test("translates missing sessions without exposing Pi internals", async () => {
  const service = new ExtensionService({
    getSession: async () => {
      throw Object.assign(new Error("private storage path"), { code: "pi_session_not_found" });
    },
  });

  await assert.rejects(service.list({ sessionId: "missing" }), (error: unknown) => {
    assert.ok(error instanceof ExtensionServiceError);
    assert.equal(error.code, "session-not-found");
    assert.deepEqual(error.details, { sessionId: "missing" });
    assert.equal(error.message.includes("private storage path"), false);
    return true;
  });
});

test("maps resource loader failures to a stable internal error", async () => {
  const service = new ExtensionService({
    getSession: async () => ({
      session: {
        resourceLoader: {
          getExtensions() {
            throw new Error("broken extension module");
          },
        },
      },
    }),
  });

  await assert.rejects(service.list({ sessionId: "session-1" }), (error: unknown) => {
    assert.ok(error instanceof ExtensionServiceError);
    assert.equal(error.code, "internal");
    assert.deepEqual(error.details, {});
    return true;
  });
});
