import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DefaultResourceLoader,
  SettingsManager,
  formatSkillsForPrompt,
} from "@earendil-works/pi-coding-agent";

import { withWorkbenchBuiltinSkills } from "../../src/skills/builtin-skills";
import { SkillService, SkillServiceError } from "../../src/skills/skill-service";
import { CommandService } from "../../src/commands/command-service";
import { createSession, getOrStartSession } from "../../src/sessions/session-registry";
import { ensureWorkbenchBuiltinResources } from "../../src/builtin-resources";
import { piBuiltinPromptCatalogs } from "@workbench/agent-runtime-pi-shared/builtin-prompts";

test("sessions persist bundled skill switches through reload and cold reopen", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-session-skills-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  const hosts: Awaited<ReturnType<typeof createSession>>[] = [];
  t.after(async () => {
    for (const host of hosts) await host.shutdown();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  });
  const host = await createSession(root, "builtin-skills");
  hosts.push(host);
  const check = (current: typeof host) => {
    const skill = current.session.resourceLoader
      .getSkills()
      .skills.find(({ name }) => name === "skill-creator");
    assert.equal(skill?.sourceInfo.source, "builtin");
    assert.equal(
      skill?.filePath,
      path.join(root, "agent", "skills", ".builtin", "skill-creator", "SKILL.md"),
    );
    assert.ok(current.session.systemPrompt.includes(skill!.filePath));
  };
  check(host);
  await host.session.reload();
  check(host);
  const service = new SkillService();
  await service.setEnabled({ sessionId: host.id, name: "skill-creator", enabled: false });
  assert.equal(
    host.session.resourceLoader.getSkills().skills.some((skill) => skill.name === "skill-creator"),
    false,
  );
  assert.equal(host.session.systemPrompt.includes("skills/.builtin/skill-creator/SKILL.md"), false);
  assert.equal(
    (await service.list({ sessionId: host.id })).skills.find(
      (skill) => skill.name === "skill-creator",
    )?.enabled,
    false,
  );
  await host.shutdown();
  const reopened = await getOrStartSession(host.id);
  hosts.push(reopened);
  assert.equal(
    reopened.session.resourceLoader
      .getSkills()
      .skills.some((skill) => skill.name === "skill-creator"),
    false,
  );
  await service.setEnabled({ sessionId: reopened.id, name: "skill-creator", enabled: true });
  check(reopened);
});

test("bundled skills can toggle while files remain read-only", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-builtin-skills-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settingsManager = SettingsManager.inMemory({}, { projectTrusted: false });
  const agentDir = path.join(root, "agent");
  await ensureWorkbenchBuiltinResources(agentDir);
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noThemes: true,
    noContextFiles: true,
    skillsOverride: (base) =>
      withWorkbenchBuiltinSkills(base, agentDir, settingsManager.getGlobalSettings().skills ?? []),
  });
  await loader.reload();
  const { skills, diagnostics } = loader.getSkills();
  assert.deepEqual(diagnostics, []);
  assert.equal(skills.length, 1);
  const skill = skills[0];
  assert.equal(skill.name, "skill-creator");
  assert.equal(skill.sourceInfo.source, "builtin");
  assert.equal(skill.sourceInfo.scope, "user");
  assert.equal(skill.disableModelInvocation, false);
  assert.ok(formatSkillsForPrompt(skills).includes(skill.filePath));
  const host = {
    session: { resourceLoader: loader, settingsManager, sessionManager: { getCwd: () => root } },
  };
  const service = new SkillService({
    agentDir: () => agentDir,
    getSession: async () => host,
    getScopedResourceHost: async () => host,
  });
  const request = { target: { scope: "user" as const }, name: skill.name };
  assert.ok(
    (await service.list(request)).skills.some(
      (entry) => entry.name === skill.name && entry.enabled,
    ),
  );
  assert.equal((await service.describe(request)).content, await readFile(skill.filePath, "utf8"));
  assert.ok((await service.listFiles(request)).entries.some((entry) => entry.name === "SKILL.md"));
  assert.equal(
    (await service.readFile({ ...request, relativePath: "SKILL.md" })).content,
    await readFile(skill.filePath, "utf8"),
  );
  const commands = new CommandService({
    getSession: async () => host,
    getScopedResourceHost: async () => host,
  });
  assert.ok(
    (await commands.list({ target: request.target })).commands.some(
      (entry) => entry.invocationName === `skill:${skill.name}`,
    ),
  );
  await service.setEnabled({ ...request, enabled: false });
  await loader.reload();
  assert.equal(loader.getSkills().skills.length, 0);
  assert.equal((await service.list(request)).skills[0]?.enabled, false);
  assert.equal(
    (await commands.list({ target: request.target })).commands.some(
      (entry) => entry.invocationName === `skill:${skill.name}`,
    ),
    false,
  );
  assert.ok((await service.describe(request)).content);
  await assert.rejects(
    service.remove(request),
    (error: unknown) => error instanceof SkillServiceError && error.code === "skill-read-only",
  );
  await service.setEnabled({ ...request, enabled: true });
  assert.deepEqual(settingsManager.getGlobalSettings().skills, []);
  await loader.reload();
  assert.deepEqual(
    loader.getSkills().skills.map(({ name }) => name),
    [skill.name],
  );
});

test("keeps an existing same-name skill and its diagnostics", async (t) => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "workbench-skill-override-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  await ensureWorkbenchBuiltinResources(agentDir);
  const original = withWorkbenchBuiltinSkills({ skills: [], diagnostics: [] }, agentDir).skills[0];
  const custom = {
    ...original,
    filePath: "/custom/SKILL.md",
    description: "User instructions",
    sourceInfo: { ...original.sourceInfo, source: "auto" },
  };
  const diagnostic = {
    type: "warning" as const,
    message: "Existing diagnostic",
    path: "/custom/SKILL.md",
  };
  const result = withWorkbenchBuiltinSkills(
    { skills: [custom], diagnostics: [diagnostic] },
    agentDir,
  );
  assert.deepEqual(result.skills, [custom]);
  assert.deepEqual(result.diagnostics, [diagnostic]);
});

test("bundled validator accepts a real skill and rejects missing descriptions and mismatched names", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-skill-validator-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await ensureWorkbenchBuiltinResources(root);
  const builtin = withWorkbenchBuiltinSkills({ skills: [], diagnostics: [] }, root).skills[0];
  const validator = path.join(builtin.baseDir, "scripts", "validate-skill.mjs");
  const run = (directory: string) =>
    spawnSync(process.execPath, [validator, directory], { encoding: "utf8" });
  const valid = run(builtin.baseDir);
  assert.equal(valid.status, 0, valid.stderr);
  const directory = path.join(root, "example");
  await mkdir(directory);
  await writeFile(path.join(directory, "SKILL.md"), "---\nname: example\n---\n\n# Example\n");
  assert.equal(run(directory).status, 1);
  await writeFile(
    path.join(directory, "SKILL.md"),
    "---\nname: different\ndescription: Example workflow.\n---\n\n# Example\n",
  );
  assert.equal(run(directory).status, 1);
  await writeFile(
    path.join(directory, "SKILL.md"),
    "---\ndescription: Example workflow.\n---\n\n# Example\n",
  );
  assert.equal(run(directory).status, 1);
  await writeFile(
    path.join(directory, "SKILL.md"),
    "---\nname: example\ndescription: Example workflow.\n---\n",
  );
  assert.equal(run(directory).status, 1);
  await writeFile(
    path.join(directory, "SKILL.md"),
    "---\nname: example\ndescription: Example workflow.\n---\n\n# Example\n",
  );
  const created = run(directory);
  assert.equal(created.status, 0, created.stderr);
});

test("installs all built-in resource kinds without touching custom files or duplicate discovery", async (t) => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "workbench-builtin-resources-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  await mkdir(path.join(agentDir, "prompts"));
  const custom = path.join(agentDir, "prompts", "custom.md");
  await writeFile(custom, "Custom instructions\n");
  const legacySkill = path.join(agentDir, "skills", ".builtin", "skills-creator");
  await mkdir(legacySkill, { recursive: true });
  await writeFile(path.join(legacySkill, "SKILL.md"), "Old built-in skill");
  const disabledPath = "-skills/.builtin/skills-creator/SKILL.md";
  await writeFile(
    path.join(agentDir, "settings.json"),
    JSON.stringify({ skills: [disabledPath, "custom-skill"] }),
  );
  const directories = await ensureWorkbenchBuiltinResources(agentDir);
  await assert.rejects(stat(legacySkill), { code: "ENOENT" });
  assert.deepEqual(SettingsManager.create(agentDir, agentDir).getGlobalSettings().skills, [
    "-skills/.builtin/skill-creator/SKILL.md",
    "custom-skill",
  ]);
  assert.equal(
    withWorkbenchBuiltinSkills({ skills: [], diagnostics: [] }, agentDir).skills.length,
    0,
  );
  for (const [kind, directory] of Object.entries(directories)) {
    assert.equal(directory, path.join(agentDir, kind, ".builtin"));
  }
  assert.ok(
    (await readFile(path.join(directories.extensions, "todo.ts"), "utf8")).includes(
      "createTodoExtension",
    ),
  );
  for (const [locale, templates] of Object.entries(piBuiltinPromptCatalogs)) {
    for (const [name, template] of Object.entries(templates)) {
      assert.equal(
        await readFile(path.join(directories.prompts, locale, `prompts-${name}.md`), "utf8"),
        template.content + "\n",
      );
    }
  }
  const skill = path.join(directories.skills, "skill-creator", "SKILL.md");
  const before = await stat(skill);
  await Promise.all([
    ensureWorkbenchBuiltinResources(agentDir),
    ensureWorkbenchBuiltinResources(agentDir),
  ]);
  assert.equal((await stat(skill)).mtimeMs, before.mtimeMs);
  assert.equal(await readFile(custom, "utf8"), "Custom instructions\n");
  const loader = new DefaultResourceLoader({
    cwd: agentDir,
    agentDir,
    settingsManager: SettingsManager.inMemory({}, { projectTrusted: false }),
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  assert.ok(!loader.getSkills().skills.some(({ name }) => name === "skill-creator"));
  assert.ok(!loader.getExtensions().extensions.some(({ path: file }) => file.includes(".builtin")));
  assert.ok(!loader.getPrompts().prompts.some(({ filePath }) => filePath.includes(".builtin")));
  await rm(path.join(directories.skills, "skill-creator", "scripts"), { recursive: true });
  const outside = path.join(agentDir, "outside");
  await mkdir(outside);
  await symlink(outside, path.join(directories.skills, "skill-creator", "scripts"), "dir");
  await assert.rejects(ensureWorkbenchBuiltinResources(agentDir), /symbolic link/);
});
