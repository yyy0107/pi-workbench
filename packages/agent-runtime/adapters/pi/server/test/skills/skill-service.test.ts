import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { tmpdir } from "node:os";
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
const { MAX_SKILL_DOCUMENT_BYTES, SkillService, SkillServiceError } = (await import(
  new URL("../../src/skills/skill-service.ts", import.meta.url).href
)) as typeof import("../../src/skills/skill-service");
const { SettingsManager } = await import("@earendil-works/pi-coding-agent");
moduleHooks.deregister();

function host(
  skills: Array<{
    name: string;
    description: string;
    disableModelInvocation: boolean;
    filePath: string;
    sourceInfo: {
      source: string;
      scope: "user" | "project" | "temporary";
      origin: "package" | "top-level";
      baseDir?: string;
    };
  }>,
) {
  return {
    session: {
      resourceLoader: {
        getSkills: () => ({ skills }),
      },
    },
  };
}

test("lists the skills loaded by the target Pi session", async () => {
  const requestedSessionIds: string[] = [];
  const service = new SkillService({
    getSession: async (sessionId) => {
      requestedSessionIds.push(sessionId);
      return host([
        {
          name: "review",
          description: "Review the current changes.",
          disableModelInvocation: false,
          filePath: "/skills/review/SKILL.md",
          sourceInfo: {
            source: "npm:@acme/review",
            scope: "project",
            origin: "package",
          },
        },
        {
          name: "release",
          description: "Prepare a release when explicitly requested.",
          disableModelInvocation: true,
          filePath: "/skills/release/SKILL.md",
          sourceInfo: {
            source: "auto",
            scope: "user",
            origin: "top-level",
          },
        },
      ]);
    },
  });

  assert.deepEqual(await service.list({ sessionId: "session-1" }), {
    skills: [
      {
        name: "review",
        description: "Review the current changes.",
        enabled: true,
        modelInvocable: true,
        source: "npm:@acme/review",
        scope: "project",
        origin: "package",
      },
      {
        name: "release",
        description: "Prepare a release when explicitly requested.",
        enabled: true,
        modelInvocable: false,
        source: "auto",
        scope: "user",
        origin: "top-level",
      },
    ],
  });
  assert.deepEqual(requestedSessionIds, ["session-1"]);
});

test("lists a Toolbox scope without resolving a Pi session", async () => {
  const requestedTargets: unknown[] = [];
  const service = new SkillService({
    getSession: async () => {
      throw new Error("Toolbox catalogs must not resolve sessions");
    },
    getScopedResourceHost: async (target) => {
      requestedTargets.push(target);
      return host([
        {
          name: "user-review",
          description: "Review user changes.",
          disableModelInvocation: false,
          filePath: "/skills/user-review/SKILL.md",
          sourceInfo: { source: "auto", scope: "user", origin: "top-level" },
        },
        {
          name: "project-review",
          description: "Review project changes.",
          disableModelInvocation: false,
          filePath: "/skills/project-review/SKILL.md",
          sourceInfo: { source: "auto", scope: "project", origin: "top-level" },
        },
      ]);
    },
  });

  const result = await service.list({ target: { scope: "user" } });
  assert.deepEqual(
    result.skills.map((skill) => skill.name),
    ["user-review"],
  );
  assert.deepEqual(requestedTargets, [{ scope: "user" }]);

  await assert.rejects(
    service.describe({
      target: { scope: "project", workspaceId: "project-1" },
      name: "user-review",
    }),
    (error: unknown) => error instanceof SkillServiceError && error.code === "skill-not-found",
  );
});

test("keeps disabled resolved skills in the catalog so they can be enabled again", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-workbench-disabled-skill-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const skillDirectory = path.join(cwd, ".pi", "skills", "disabled-review");
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    path.join(skillDirectory, "SKILL.md"),
    "---\nname: disabled-review\ndescription: Review while disabled.\n---\n\n# Review\n",
  );
  const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true });
  settingsManager.setProjectSkillPaths(["-skills/disabled-review/SKILL.md"]);
  await settingsManager.flush();
  const service = new SkillService({
    getSession: async () => ({
      session: {
        resourceLoader: { getSkills: () => ({ skills: [] }) },
        settingsManager,
        sessionManager: { getCwd: () => cwd },
      },
    }),
  });

  const skill = (await service.list({ sessionId: "session-1" })).skills.find(
    (candidate) => candidate.name === "disabled-review",
  );
  assert.deepEqual(skill, {
    name: "disabled-review",
    description: "Review while disabled.",
    enabled: false,
    modelInvocable: true,
    source: "auto",
    scope: "project",
    origin: "top-level",
  });
});

test("reads the selected loaded skill document from its authoritative path", async () => {
  const requestedPaths: string[] = [];
  const service = new SkillService({
    getSession: async () =>
      host([
        {
          name: "review",
          description: "Review the current changes.",
          disableModelInvocation: false,
          filePath: "/private/project/.pi/skills/review/SKILL.md",
          sourceInfo: {
            source: "auto",
            scope: "project",
            origin: "top-level",
          },
        },
      ]),
    readSkillDocument: async (filePath) => {
      requestedPaths.push(filePath);
      return "---\nname: review\n---\n\n# Review\n";
    },
  });

  assert.deepEqual(await service.describe({ sessionId: "session-1", name: "review" }), {
    name: "review",
    content: "---\nname: review\n---\n\n# Review\n",
    filePath: "/private/project/.pi/skills/review/SKILL.md",
  });
  assert.deepEqual(requestedPaths, ["/private/project/.pi/skills/review/SKILL.md"]);
});

test("persists the official exact Skill filter and reloads an idle session", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-workbench-toggle-skill-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const baseDir = path.join(cwd, ".pi");
  const skillDirectory = path.join(baseDir, "skills", "review");
  const skillFile = path.join(skillDirectory, "SKILL.md");
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    skillFile,
    "---\nname: review\ndescription: Review the current changes.\n---\n\n# Review\n",
  );
  const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true });
  let reloadCount = 0;
  const service = new SkillService({
    getSession: async () => ({
      isRunning: false,
      session: {
        resourceLoader: {
          getSkills: () => ({
            skills: [
              {
                name: "review",
                description: "Review the current changes.",
                disableModelInvocation: false,
                filePath: skillFile,
                sourceInfo: {
                  source: "auto",
                  scope: "project",
                  origin: "top-level",
                  baseDir,
                },
              },
            ],
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
    await service.setEnabled({ sessionId: "session-1", name: "review", enabled: false }),
    { name: "review", enabled: false },
  );
  assert.deepEqual(settingsManager.getProjectSettings().skills, ["-skills/review/SKILL.md"]);
  assert.equal(reloadCount, 1);

  assert.deepEqual(
    await service.setEnabled({ sessionId: "session-1", name: "review", enabled: true }),
    { name: "review", enabled: true },
  );
  assert.deepEqual(settingsManager.getProjectSettings().skills, ["+skills/review/SKILL.md"]);
  assert.equal(reloadCount, 2);
});

test("rejects unknown skill names without reading a caller-controlled path", async () => {
  let readCalled = false;
  const service = new SkillService({
    getSession: async () => host([]),
    readSkillDocument: async () => {
      readCalled = true;
      return "unexpected";
    },
  });

  await assert.rejects(
    service.describe({ sessionId: "session-1", name: "../../private" }),
    (error: unknown) => {
      assert.ok(error instanceof SkillServiceError);
      assert.equal(error.code, "skill-not-found");
      assert.deepEqual(error.details, { sessionId: "session-1", name: "../../private" });
      return true;
    },
  );
  assert.equal(readCalled, false);
});

test("rejects skill documents larger than the display limit", async () => {
  const service = new SkillService({
    getSession: async () =>
      host([
        {
          name: "large",
          description: "Large document.",
          disableModelInvocation: false,
          filePath: "/skills/large/SKILL.md",
          sourceInfo: {
            source: "auto",
            scope: "user",
            origin: "top-level",
          },
        },
      ]),
    readSkillDocument: async () => "x".repeat(MAX_SKILL_DOCUMENT_BYTES + 1),
  });

  await assert.rejects(
    service.describe({ sessionId: "session-1", name: "large" }),
    (error: unknown) => {
      assert.ok(error instanceof SkillServiceError);
      assert.equal(error.code, "skill-document-too-large");
      assert.deepEqual(error.details, {
        name: "large",
        maxBytes: MAX_SKILL_DOCUMENT_BYTES,
      });
      return true;
    },
  );
});

test("maps skill document read failures without exposing the source path", async () => {
  const privatePath = "/private/project/.pi/skills/review/SKILL.md";
  const service = new SkillService({
    getSession: async () =>
      host([
        {
          name: "review",
          description: "Review the current changes.",
          disableModelInvocation: false,
          filePath: privatePath,
          sourceInfo: {
            source: "auto",
            scope: "project",
            origin: "top-level",
          },
        },
      ]),
    readSkillDocument: async () => {
      throw new Error(`Cannot read ${privatePath}`);
    },
  });

  await assert.rejects(
    service.describe({ sessionId: "session-1", name: "review" }),
    (error: unknown) => {
      assert.ok(error instanceof SkillServiceError);
      assert.equal(error.code, "internal");
      assert.deepEqual(error.details, {});
      assert.equal(error.message.includes(privatePath), false);
      return true;
    },
  );
});

test("lists and reads only files contained by the selected Skill directory", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-workbench-skill-files-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const skillDirectory = path.join(cwd, "review");
  const referencesDirectory = path.join(skillDirectory, "references");
  const skillFile = path.join(skillDirectory, "SKILL.md");
  const outsideFile = path.join(cwd, "outside.md");
  await mkdir(referencesDirectory, { recursive: true });
  await writeFile(skillFile, "# Review\n");
  await writeFile(path.join(referencesDirectory, "guide.md"), "# Guide\n");
  await writeFile(outsideFile, "private\n");
  await symlink(outsideFile, path.join(skillDirectory, "escape.md"));
  const service = new SkillService({
    getSession: async () =>
      host([
        {
          name: "review",
          description: "Review changes.",
          disableModelInvocation: false,
          filePath: skillFile,
          sourceInfo: {
            source: "auto",
            scope: "user",
            origin: "top-level",
            baseDir: cwd,
          },
        },
      ]),
  });

  const root = await service.listFiles({ sessionId: "session-1", name: "review" });
  assert.equal(root.rootPath, skillDirectory);
  assert.deepEqual(
    root.entries.map(({ name, kind }) => ({ name, kind })),
    [
      { name: "references", kind: "directory" },
      { name: "SKILL.md", kind: "file" },
    ],
  );
  assert.deepEqual(
    (
      await service.listFiles({
        sessionId: "session-1",
        name: "review",
        relativePath: "references",
      })
    ).entries.map(({ name, relativePath }) => ({ name, relativePath })),
    [{ name: "guide.md", relativePath: "references/guide.md" }],
  );
  const guide = await service.readFile({
    sessionId: "session-1",
    name: "review",
    relativePath: "references/guide.md",
  });
  assert.equal(guide.skillName, "review");
  assert.equal(guide.rootPath, skillDirectory);
  assert.equal(guide.relativePath, "references/guide.md");
  assert.equal(guide.absolutePath, path.join(referencesDirectory, "guide.md"));
  assert.equal(guide.name, "guide.md");
  assert.equal(guide.content, "# Guide\n");
  assert.equal(guide.mediaType, "text/markdown");
  assert.equal(guide.encoding, "utf-8");
  assert.match(guide.version, /^sha256:/);
  await assert.rejects(
    service.listFiles({ sessionId: "session-1", name: "review", relativePath: ".." }),
    (error: unknown) => {
      assert.ok(error instanceof SkillServiceError);
      assert.equal(error.code, "skill-directory-unreadable");
      return true;
    },
  );
  for (const relativePath of ["../outside.md", "escape.md"]) {
    await assert.rejects(
      service.readFile({ sessionId: "session-1", name: "review", relativePath }),
      (error: unknown) => {
        assert.ok(error instanceof SkillServiceError);
        assert.equal(error.code, "skill-file-unreadable");
        return true;
      },
    );
  }
});

test("deletes only an independently installed Skill root and reloads the session", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-workbench-remove-skill-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const baseDir = path.join(cwd, ".pi");
  const skillDirectory = path.join(baseDir, "skills", "remove-me");
  const skillFile = path.join(skillDirectory, "SKILL.md");
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(skillFile, "# Remove me\n");
  let reloadCount = 0;
  const service = new SkillService({
    getSession: async () => ({
      isRunning: false,
      session: {
        resourceLoader: {
          getSkills: () => ({
            skills: [
              {
                name: "remove-me",
                description: "Remove this Skill.",
                disableModelInvocation: false,
                filePath: skillFile,
                sourceInfo: {
                  source: "auto",
                  scope: "user",
                  origin: "top-level",
                  baseDir,
                },
              },
            ],
          }),
        },
        sessionManager: { getCwd: () => cwd },
        reload: async () => {
          reloadCount += 1;
        },
      },
    }),
  });

  assert.deepEqual(await service.remove({ sessionId: "session-1", name: "remove-me" }), {
    name: "remove-me",
    removed: true,
  });
  await assert.rejects(stat(skillDirectory), { code: "ENOENT" });
  assert.equal(reloadCount, 1);
});

test("translates missing sessions without exposing Pi internals", async () => {
  const service = new SkillService({
    getSession: async () => {
      throw Object.assign(new Error("private storage path"), { code: "pi_session_not_found" });
    },
  });

  await assert.rejects(service.list({ sessionId: "missing" }), (error: unknown) => {
    assert.ok(error instanceof SkillServiceError);
    assert.equal(error.code, "session-not-found");
    assert.deepEqual(error.details, { sessionId: "missing" });
    assert.equal(error.message.includes("private storage path"), false);
    return true;
  });
});

test("maps resource loader failures to a stable internal error", async () => {
  const service = new SkillService({
    getSession: async () => ({
      session: {
        resourceLoader: {
          getSkills() {
            throw new Error("broken skill document");
          },
        },
      },
    }),
  });

  await assert.rejects(service.list({ sessionId: "session-1" }), (error: unknown) => {
    assert.ok(error instanceof SkillServiceError);
    assert.equal(error.code, "internal");
    assert.deepEqual(error.details, {});
    return true;
  });
});
