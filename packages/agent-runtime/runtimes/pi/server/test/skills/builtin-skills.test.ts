import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
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

for (const name of ["skill-creator", "pi-docs", "skill-installer", "extension-creator"]) {
  test(`bundled ${name} can toggle while files remain read-only`, async (t) => {
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
        withWorkbenchBuiltinSkills(
          base,
          agentDir,
          settingsManager.getGlobalSettings().skills ?? [],
        ),
    });
    await loader.reload();
    const { skills, diagnostics } = loader.getSkills();
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(skills.map(({ name }) => name).sort(), [
      "extension-creator",
      "pi-docs",
      "skill-creator",
      "skill-installer",
    ]);
    const skill = skills.find((entry) => entry.name === name)!;
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
    assert.ok(
      (await service.listFiles(request)).entries.some((entry) => entry.name === "SKILL.md"),
    );
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
    assert.deepEqual(
      loader.getSkills().skills,
      skills.filter((entry) => entry.name !== name),
    );
    assert.equal(
      (await service.list(request)).skills.find((entry) => entry.name === name)?.enabled,
      false,
    );
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
      skills.map(({ name }) => name),
    );
  });
}

test("keeps an existing same-name skill and its diagnostics", async (t) => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "workbench-skill-override-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  await ensureWorkbenchBuiltinResources(agentDir);
  const builtins = withWorkbenchBuiltinSkills({ skills: [], diagnostics: [] }, agentDir).skills;
  const original = builtins[0];
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
  assert.deepEqual(result.skills, [custom, ...builtins.slice(1)]);
  assert.deepEqual(result.diagnostics, [diagnostic]);
});

test("bundled validator accepts a real skill and rejects missing descriptions and mismatched names", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-skill-validator-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await ensureWorkbenchBuiltinResources(root);
  const skills = withWorkbenchBuiltinSkills({ skills: [], diagnostics: [] }, root).skills;
  const builtin = skills.find(({ name }) => name === "skill-creator")!;
  const validator = path.join(builtin.baseDir, "scripts", "validate-skill.mjs");
  const run = (directory: string) =>
    spawnSync(process.execPath, [validator, directory], { encoding: "utf8" });
  const valid = run(builtin.baseDir);
  assert.equal(valid.status, 0, valid.stderr);
  const piDocs = skills.find(({ name }) => name === "pi-docs")!;
  const docsValidation = run(piDocs.baseDir);
  assert.equal(docsValidation.status, 0, docsValidation.stderr);
  const installer = skills.find(({ name }) => name === "skill-installer")!;
  const installerValidation = run(installer.baseDir);
  assert.equal(installerValidation.status, 0, installerValidation.stderr);
  const extensionCreator = skills.find(({ name }) => name === "extension-creator")!;
  const extensionCreatorValidation = run(extensionCreator.baseDir);
  assert.equal(extensionCreatorValidation.status, 0, extensionCreatorValidation.stderr);
  const extensionRuntime = JSON.parse(
    await readFile(path.join(extensionCreator.baseDir, "runtime.json"), "utf8"),
  );
  assert.equal(extensionRuntime.userResourceDir, root);
  assert.equal(extensionRuntime.nodeExecutable, process.execPath);
  assert.equal(
    typeof (await import(extensionRuntime.piCodingAgentModule)).discoverAndLoadExtensions,
    "function",
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(installer.baseDir, "runtime.json"), "utf8")),
    { userResourceDir: root },
  );
  const runtime = JSON.parse(await readFile(path.join(piDocs.baseDir, "runtime.json"), "utf8"));
  const manifest = JSON.parse(
    await readFile(path.join(runtime.packageDir, "package.json"), "utf8"),
  );
  assert.equal(manifest.name, "@earendil-works/pi-coding-agent");
  assert.equal(runtime.version, manifest.version);
  for (const file of [
    runtime.readme,
    path.join(runtime.docs, "extensions.md"),
    path.join(runtime.packageDir, "dist", "index.d.ts"),
  ]) {
    assert.ok(path.isAbsolute(file));
    assert.ok((await readFile(file, "utf8")).length > 0);
  }
  assert.ok((await readdir(path.join(runtime.examples, "extensions"))).length > 0);
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

test("installs built-in skills and extensions and removes retired prompts without touching custom files", async (t) => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "workbench-builtin-resources-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  await mkdir(path.join(agentDir, "prompts"));
  const custom = path.join(agentDir, "prompts", "custom.md");
  await writeFile(custom, "Custom instructions\n");
  const legacyExtensions = path.join(agentDir, "extensions", ".builtin");
  await mkdir(legacyExtensions, { recursive: true });
  for (const name of [
    "ask-user",
    "builtin-tools",
    "composer-context",
    "context-trace",
    "enhanced-search",
    "index",
    "legacy-message-termination",
    "legacy-message-termination-extension-source",
    "message-termination",
    "system-prompt-hook-trace",
    "todo",
    "tool-availability",
  ])
    await writeFile(path.join(legacyExtensions, `${name}.ts`), "Old source snapshot\n");
  const retiredPrompts = ["pi-extension", "pi-hook", "pi-tool", "pi-skill"];
  for (const locale of ["en-US", "zh-CN"]) {
    const directory = path.join(agentDir, "prompts", ".builtin", locale);
    await mkdir(directory, { recursive: true });
    for (const name of retiredPrompts) {
      await writeFile(path.join(directory, `prompts-${name}.md`), "Old prompt\n");
      const installed = path.join(agentDir, "prompts", ".builtin", name);
      await mkdir(installed, { recursive: true });
      await writeFile(path.join(installed, `${locale}.md`), "Installed prompt\n");
      await writeFile(path.join(installed, "LICENSE.pi"), "Old license\n");
    }
  }
  await writeFile(path.join(agentDir, "prompts", ".builtin", "LICENSE.pi"), "Old license\n");
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
    withWorkbenchBuiltinSkills({ skills: [], diagnostics: [] }, agentDir).skills.some(
      ({ name }) => name === "skill-creator",
    ),
    false,
  );
  for (const [kind, directory] of Object.entries(directories)) {
    assert.equal(directory, path.join(agentDir, kind, ".builtin"));
    assert.ok(
      (await readdir(directory, { withFileTypes: true })).every((entry) => entry.isDirectory()),
    );
  }
  assert.deepEqual((await readdir(directories.extensions)).sort(), [
    "_shared",
    "ask-user",
    "builtin-tools",
    "composer-context",
    "context-trace",
    "enhanced-search",
    "message-termination",
    "rpiv-todo",
  ]);
  for (const name of [
    "ask-user",
    "builtin-tools",
    "composer-context",
    "context-trace",
    "enhanced-search",
    "message-termination",
    "rpiv-todo",
  ])
    assert.ok((await stat(path.join(directories.extensions, name, "index.ts"))).isFile());
  assert.ok(
    (await readFile(path.join(directories.extensions, "rpiv-todo", "index.ts"), "utf8")).includes(
      "createTodoExtension",
    ),
  );
  assert.ok(
    (await stat(path.join(directories.extensions, "rpiv-todo", "state", "replay.ts"))).isFile(),
  );
  assert.ok(
    (
      await stat(path.join(directories.extensions, "context-trace", "system-prompt-hook-trace.ts"))
    ).isFile(),
  );
  assert.ok(
    (
      await stat(
        path.join(directories.extensions, "message-termination", "legacy-message-termination.ts"),
      )
    ).isFile(),
  );
  assert.deepEqual(await readdir(directories.prompts), []);
  // Unknown files in a legacy directory must survive cleanup as well.
  const legacyLocale = path.join(directories.prompts, "en-US");
  await mkdir(legacyLocale);
  const unknown = path.join(legacyLocale, "custom.md");
  await writeFile(unknown, "Keep this file\n");
  const retiredDirectory = path.join(directories.prompts, "pi-skill");
  await mkdir(retiredDirectory);
  const customCopy = path.join(retiredDirectory, "custom.md");
  await writeFile(customCopy, "Keep my copy\n");
  const skill = path.join(directories.skills, "skill-creator", "SKILL.md");
  const before = await stat(skill);
  await Promise.all([
    ensureWorkbenchBuiltinResources(agentDir),
    ensureWorkbenchBuiltinResources(agentDir),
  ]);
  assert.equal((await stat(skill)).mtimeMs, before.mtimeMs);
  assert.equal(await readFile(custom, "utf8"), "Custom instructions\n");
  assert.equal(await readFile(unknown, "utf8"), "Keep this file\n");
  assert.equal(await readFile(customCopy, "utf8"), "Keep my copy\n");
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

test("built-in migration does not follow legacy prompt directory links", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-builtin-migration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = path.join(root, "agent");
  const outside = path.join(root, "outside");
  await mkdir(outside);
  const custom = path.join(outside, "prompts-pi-skill.md");
  await writeFile(custom, "User content\n");
  const prompts = path.join(agentDir, "prompts", ".builtin");
  await mkdir(prompts, { recursive: true });
  for (const name of ["en-US", "pi-skill"]) {
    const link = path.join(prompts, name);
    await symlink(outside, link, "dir");
    await assert.rejects(ensureWorkbenchBuiltinResources(agentDir), /symbolic link/);
    assert.equal(await readFile(custom, "utf8"), "User content\n");
    await rm(link);
  }
});
