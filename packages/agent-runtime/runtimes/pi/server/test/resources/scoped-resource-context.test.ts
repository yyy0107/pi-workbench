import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ScopedResourceContextService } from "../../src/resources/scoped-resource-context";
import { SkillService } from "../../src/skills/skill-service";

test("creates cached user and project resource catalogs without an AgentSession", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-scoped-resources-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const applicationCwd = path.join(root, "application");
  const projectCwd = path.join(root, "project");
  const agentDir = path.join(root, "agent");
  const workspaceLookups: string[] = [];
  const service = new ScopedResourceContextService({
    applicationCwd: () => applicationCwd,
    agentDir: () => agentDir,
    getWorkspace: async (workspaceId) => {
      workspaceLookups.push(workspaceId);
      return workspaceId === "project-1" ? { path: projectCwd } : undefined;
    },
    isProjectTrusted: async (workspacePath) => workspacePath === projectCwd,
  });

  const user = await service.get({ scope: "user" });
  const project = await service.get({ scope: "project", workspaceId: "project-1" });

  assert.equal(user.cwd, applicationCwd);
  assert.equal(user.settingsManager.isProjectTrusted(), false);
  assert.equal(project.cwd, projectCwd);
  assert.equal(project.settingsManager.isProjectTrusted(), true);
  assert.equal(await service.get({ scope: "project", workspaceId: "project-1" }), project);
  assert.deepEqual(workspaceLookups, ["project-1"]);
  for (const context of [user, project]) {
    const skill = context.resourceLoader
      .getSkills()
      .skills.find((entry) => entry.name === "skill-creator");
    assert.equal(skill, undefined);
    const builtin = context.resourceLoader
      .getExtensions()
      .extensions.find((extension) => extension.path === "<inline:workbench.rpiv-todo>");
    assert.ok(builtin?.hidden);
    assert.equal(builtin.tools.get("todo")?.definition.name, "todo");
    assert.ok(builtin.handlers.has("session_start"));
  }
});

test("rejects an unknown project scope before loading resources", async () => {
  const service = new ScopedResourceContextService({
    getWorkspace: async () => undefined,
  });

  await assert.rejects(
    service.get({ scope: "project", workspaceId: "missing" }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "workspace-not-found",
  );
});

test("all skill sources require opt-in, preserve saved switches, and keep new skills disabled", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-skill-defaults-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = path.join(root, "agent");
  const project = path.join(root, "project");
  const packageDir = path.join(root, "package");
  const writeSkill = async (base: string, name: string) => {
    const directory = path.join(base, "skills", name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: Test skill\n---\nInstructions.\n`,
    );
  };
  for (const name of ["user-default", "user-enabled", "user-disabled"])
    await writeSkill(agentDir, name);
  for (const name of ["project-default", "project-enabled", "project-disabled"])
    await writeSkill(path.join(project, ".pi"), name);
  for (const name of ["package-default", "package-enabled", "package-disabled"])
    await writeSkill(packageDir, name);
  await writeFile(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name: "skill-package", pi: { skills: ["./skills"] } }),
  );
  await writeFile(
    path.join(agentDir, "settings.json"),
    JSON.stringify({
      skills: ["+skills/user-enabled/SKILL.md", "-skills/user-disabled/SKILL.md"],
      packages: [
        {
          source: packageDir,
          skills: ["+skills/package-enabled/SKILL.md", "-skills/package-disabled/SKILL.md"],
        },
      ],
    }),
  );
  await writeFile(
    path.join(project, ".pi", "settings.json"),
    JSON.stringify({
      skills: ["+skills/project-enabled/SKILL.md", "-skills/project-disabled/SKILL.md"],
    }),
  );
  const contexts = new ScopedResourceContextService({
    agentDir: () => agentDir,
    applicationCwd: () => root,
    getWorkspace: async () => ({ path: project }),
    isProjectTrusted: async () => true,
  });
  const target = { scope: "project" as const, workspaceId: "project" };
  const context = await contexts.get(target);
  const loadedNames = () =>
    context.resourceLoader
      .getSkills()
      .skills.map(({ name }) => name)
      .sort();
  assert.deepEqual(loadedNames(), ["package-enabled", "project-enabled", "user-enabled"]);
  const skills = new SkillService({
    agentDir: () => agentDir,
    getScopedResourceHost: async () => ({
      session: {
        resourceLoader: context.resourceLoader,
        settingsManager: context.settingsManager,
        sessionManager: { getCwd: () => project },
        reload: context.reload,
      },
    }),
  });
  const catalog = (await skills.list({ target })).skills;
  assert.equal(catalog.find(({ name }) => name === "project-default")?.enabled, false);
  assert.equal(catalog.find(({ name }) => name === "project-enabled")?.enabled, true);
  assert.equal(catalog.find(({ name }) => name === "project-disabled")?.enabled, false);
  await skills.setEnabled({ target, name: "project-default", enabled: true });
  assert.ok(loadedNames().includes("project-default"));
  await writeSkill(packageDir, "new-package-skill");
  await writeSkill(agentDir, "new-user-skill");
  await writeSkill(path.join(project, ".pi"), "new-project-skill");
  await context.reload();
  assert.deepEqual(loadedNames(), [
    "package-enabled",
    "project-default",
    "project-enabled",
    "user-enabled",
  ]);
  contexts.invalidate();
  const reopened = await contexts.get(target);
  assert.deepEqual(
    reopened.resourceLoader
      .getSkills()
      .skills.map(({ name }) => name)
      .sort(),
    loadedNames(),
  );
  const user = await contexts.get({ scope: "user" });
  assert.deepEqual(
    user.resourceLoader
      .getSkills()
      .skills.map(({ name }) => name)
      .sort(),
    ["package-enabled", "user-enabled"],
  );
});
