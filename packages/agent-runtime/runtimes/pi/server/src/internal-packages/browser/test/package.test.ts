import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { InMemoryCredentialStore, validateToolArguments } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { BrowserCommand } from "@workbench/browser-contracts";
import type { BrowserHost } from "../index";
import { browserPackageArtifactRelativePath } from "../resources";

test("the packed Pi package loads its extension and skill without private workspace dependencies", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-browser-package-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const packageRoot = fileURLToPath(new URL("../", import.meta.url));
  const packed = spawnSync("pnpm", ["pack", "--pack-destination", directory], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const archive = path.join(directory, "workbench-pi-browser-0.1.0.tgz");
  const extracted = spawnSync("tar", ["-xzf", archive, "-C", directory], { encoding: "utf8" });
  assert.equal(extracted.status, 0, extracted.stderr);
  const root = path.join(directory, "package");
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.deepEqual(manifest.pi, { extensions: ["./index.js"], skills: ["./skills"] });
  assert.equal(manifest.exports["."], "./index.js");
  assert.equal(manifest.dependencies, undefined);
  assert.deepEqual(Object.keys(manifest.peerDependencies).sort(), [
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "typebox",
  ]);
  const code = await readFile(path.join(root, "index.js"), "utf8");
  assert.doesNotMatch(code, /(?:from\s+|import\s*\()["']@workbench\//);
  const resource = (await import(
    pathToFileURL(path.join(root, "resources.js")).href
  )) as typeof import("../resources");
  assert.equal(fileURLToPath(resource.browserPackageDirectory), root + path.sep);
  assert.equal(resource.browserPackageArtifactRelativePath, browserPackageArtifactRelativePath);
  await mkdir(path.join(directory, "agent"));
  const settingsManager = SettingsManager.inMemory(
    { packages: [root], compaction: { enabled: false }, retry: { enabled: false } },
    { projectTrusted: false },
  );
  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: path.join(directory, "agent"),
    settingsManager,
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  assert.equal(loaded.extensions[0].sourceInfo.origin, "package");
  assert.equal(loaded.extensions[0].handlers.has("session_shutdown"), true);
  assert.equal(loaded.extensions[0].handlers.has("agent_settled"), true);
  const tool = loaded.extensions
    .flatMap((extension) => [...extension.tools.values()])
    .find((entry) => entry.definition.name === "workbench_browser")?.definition;
  assert.ok(tool);
  assert.equal(tool.executionMode, "sequential");
  const skills = loader.getSkills();
  assert.deepEqual(skills.diagnostics, []);
  assert.equal(
    skills.skills.find((skill) => skill.name === "browser-use")?.filePath,
    path.join(root, "skills/browser-use/SKILL.md"),
  );
  const global = globalThis as typeof globalThis & {
    __workbenchPiAgentHostBindings?: { browser?: BrowserHost };
  };
  const previous = global.__workbenchPiAgentHostBindings;
  t.after(() => {
    if (previous === undefined) delete global.__workbenchPiAgentHostBindings;
    else global.__workbenchPiAgentHostBindings = previous;
  });
  const calls: BrowserCommand[] = [];
  let response: unknown = { name: "page.png", mimeType: "image/png", data: "cGljdHVyZQ==" };
  global.__workbenchPiAgentHostBindings = {
    browser: {
      async command(command) {
        calls.push(command);
        return response;
      },
    },
  };
  const result = await tool.execute("image", { action: "screenshot" }, undefined, undefined, {
    cwd: directory,
    sessionManager: { getSessionId: () => "package-test" },
  } as ExtensionContext);
  assert.deepEqual(result.content, [
    { type: "text", text: "{}" },
    { type: "image", mimeType: "image/png", data: "cGljdHVyZQ==" },
  ]);

  const ctx = {
    cwd: directory,
    sessionManager: { getSessionId: () => "package-test" },
  } as ExtensionContext;
  const historyArguments = { action: "history.list", params: { query: "example", limit: 20 } };
  assert.deepEqual(
    validateToolArguments(tool, {
      type: "toolCall",
      id: "history-schema",
      name: tool.name,
      arguments: historyArguments,
    }),
    historyArguments,
  );
  response = [{ url: "https://example.com/", title: "Example", time: 1 }];
  const history = await tool.execute("history", historyArguments, undefined, undefined, ctx);
  assert.deepEqual(calls.at(-1), { type: "history.list", query: "example", limit: 20 });
  assert.deepEqual(history.content, [{ type: "text", text: JSON.stringify(response) }]);
  assert.deepEqual(history.details, {}, "history does not open a default browser tab");
  const protocol = { expression: "document.title", returnByValue: true };
  response = { result: { type: "string", value: "Example" } };
  for (const params of [
    { method: "Runtime.evaluate", ...protocol },
    { method: "Runtime.evaluate", params: protocol },
  ]) {
    const arguments_ = { action: "cdp", params };
    assert.deepEqual(
      validateToolArguments(tool, {
        type: "toolCall",
        id: "cdp-schema",
        name: tool.name,
        arguments: arguments_,
      }),
      arguments_,
    );
    const evaluated = await tool.execute("cdp", arguments_, undefined, undefined, ctx);
    assert.deepEqual(calls.at(-1), {
      type: "cdp",
      sessionId: "workbench-package-test",
      method: "Runtime.evaluate",
      params: protocol,
    });
    assert.deepEqual(evaluated.content, [{ type: "text", text: JSON.stringify(response) }]);
  }
  for (const arguments_ of [
    { action: "cdp", params: { method: "Page.getFrameTree" } },
    { action: "click", params: { ref: "snapshot-1:0" } },
    { action: "click", params: { x: 160, y: 220 } },
    { action: "snapshot", params: { query: "我怀念的" } },
    { action: "fill", params: { ref: "snapshot-1:0", text: "Search" } },
  ]) {
    assert.deepEqual(
      validateToolArguments(tool, {
        type: "toolCall",
        id: "action-schema",
        name: tool.name,
        arguments: arguments_,
      }),
      arguments_,
    );
    await tool.execute("action", arguments_, undefined, undefined, ctx);
  }
  assert.deepEqual(calls.at(-5), {
    type: "cdp",
    sessionId: "workbench-package-test",
    method: "Page.getFrameTree",
    params: {},
  });
  const callCount = calls.length;
  for (const [params, error] of [
    [
      { method: "Runtime.evaluate", expression: "document.title", params: {} },
      /mix flat and nested/,
    ],
    [{ method: "Runtime.evaluate" }, /requires a non-empty expression/],
    [{ method: "Runtime.evaluate", expression: "  " }, /requires a non-empty expression/],
    [
      { method: "Runtime.evaluate", params: { returnByValue: true } },
      /requires a non-empty expression/,
    ],
    [{ expression: "document.title" }, /Invalid CDP parameters/],
  ] as const) {
    await assert.rejects(
      tool.execute("invalid", { action: "cdp", params }, undefined, undefined, ctx),
      error,
    );
  }
  assert.equal(calls.length, callCount, "invalid CDP calls fail before reaching the browser");

  response = {
    result: { type: "object", subtype: "error" },
    exceptionDetails: {
      text: "Uncaught",
      lineNumber: 0,
      columnNumber: 6,
      exception: { description: "SyntaxError: Illegal return statement" },
    },
  };
  const invalidScript = {
    action: "cdp",
    params: { method: "Runtime.evaluate", expression: "return document.title" },
  };
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const faux = fauxProvider({ tokensPerSecond: Infinity });
  modelRuntime.registerNativeProvider(faux.provider);
  const { session } = await createAgentSession({
    cwd: directory,
    agentDir: path.join(directory, "agent"),
    resourceLoader: loader,
    settingsManager,
    sessionManager: SessionManager.inMemory(directory),
    modelRuntime,
    model: faux.getModel(),
  });
  t.after(() => session.dispose());
  await session.bindExtensions({ mode: "rpc" });
  let executionIsError: boolean | undefined;
  session.subscribe((event) => {
    if (event.type === "tool_execution_end") executionIsError = event.isError;
  });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("workbench_browser", invalidScript)),
    fauxAssistantMessage("Finished"),
  ]);
  await session.prompt("Run the scripted browser check");
  assert.equal(executionIsError, true);
  const failure = session.messages.find((message) => message.role === "toolResult");
  assert.equal(failure?.isError, true);
  assert.deepEqual(failure?.content, [
    {
      type: "text",
      text: "Runtime.evaluate (line 1, column 7): SyntaxError: Illegal return statement",
    },
  ]);
  response = { exceptionDetails: { text: "ReferenceError: missing", lineNumber: 4 } };
  await assert.rejects(
    tool.execute("text-error", invalidScript, undefined, undefined, ctx),
    /Runtime.evaluate \(line 5\): ReferenceError: missing/,
  );
  response = { exceptionDetails: { exception: { description: "x".repeat(4000) } } };
  await assert.rejects(
    tool.execute("bounded-error", invalidScript, undefined, undefined, ctx),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, `Runtime.evaluate: ${"x".repeat(2048)}`);
      return true;
    },
  );
});

test("the source Pi package loads the live TypeScript entry", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-browser-source-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../", import.meta.url));
  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager: SettingsManager.inMemory({ packages: [root] }, { projectTrusted: false }),
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  assert.equal(loaded.extensions[0].resolvedPath, path.join(root, "index.ts"));
  assert.equal(loaded.extensions[0].sourceInfo.origin, "package");
  assert.equal(loaded.extensions[0].tools.has("workbench_browser"), true);
  assert.equal(loaded.extensions[0].handlers.has("session_shutdown"), true);
  assert.equal(loaded.extensions[0].handlers.has("agent_settled"), true);
  assert.equal(loader.getSkills().skills[0]?.sourceInfo.origin, "package");
  assert.equal(loader.getSkills().skills[0]?.name, "browser-use");
});
