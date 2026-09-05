import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { PI_AGENT_SETTINGS_NAMESPACE } from "@workbench/agent-runtime-pi-protocol/rpc";

const { AgentSettingsService, AgentSettingsServiceError } = (await import(
  new URL("../../src/settings/agent-settings-service.ts", import.meta.url).href
)) as typeof import("../../src/settings/agent-settings-service");

async function fixture(t: test.TestContext) {
  const agentDir = await mkdtemp(path.join(tmpdir(), "workbench-agent-settings-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  return { agentDir, service: new AgentSettingsService({ agentDir }) };
}

test("describes Pi defaults when no global agent settings exist", async (t) => {
  const { agentDir, service } = await fixture(t);
  const described = await service.describe();

  assert.equal(described.writable, true);
  assert.equal(described.hasDocument, false);
  assert.equal(described.namespaces.length, 1);
  assert.deepEqual(described.namespaces[0]?.value, {
    systemPrompt: "",
    appendSystemPrompt: "",
    compaction: {
      enabled: true,
      reserveTokens: 16_384,
      keepRecentTokens: 20_000,
    },
  });
  assert.deepEqual(described.namespaces[0]?.user, {});
  assert.equal(described.namespaces[0]?.applies, "restart");
  const builtin = described.namespaces[0]?.builtinSystemPrompt;
  assert.ok(builtin);
  assert.match(builtin, /Available tools:/u);
  assert.match(builtin, /- read:/u);
  assert.match(builtin, /- bash:/u);
  assert.doesNotMatch(builtin, /Current working directory:|\.desktop-build|node_modules/u);
  assert.ok(!builtin.includes(process.cwd().replaceAll("\\", "/")));
  assert.match(builtin, /Main documentation: @earendil-works\/pi-coding-agent\/README\.md/u);
  assert.match(builtin, /Additional docs: @earendil-works\/pi-coding-agent\/docs/u);
  assert.match(builtin, /Examples: @earendil-works\/pi-coding-agent\/examples/u);
  assert.deepEqual(await readdir(agentDir), []);
});

test("the read-only builtin preview excludes user resources and survives clearing the override", async (t) => {
  const { agentDir, service } = await fixture(t);
  await writeFile(path.join(agentDir, "SYSTEM.md"), "CUSTOM_SYSTEM_MARKER");
  await writeFile(path.join(agentDir, "APPEND_SYSTEM.md"), "CUSTOM_APPEND_MARKER");
  await writeFile(path.join(agentDir, "AGENTS.md"), "CUSTOM_CONTEXT_MARKER");
  const before = (await service.describe()).namespaces[0]!;
  assert.ok(before.builtinSystemPrompt);
  assert.doesNotMatch(before.builtinSystemPrompt, /CUSTOM_(SYSTEM|APPEND|CONTEXT)_MARKER/u);
  assert.deepEqual((await readdir(agentDir)).sort(), [
    "AGENTS.md",
    "APPEND_SYSTEM.md",
    "SYSTEM.md",
  ]);

  const after = await service.update({
    ns: PI_AGENT_SETTINGS_NAMESPACE,
    expectedRevision: before.revision,
    patch: { systemPrompt: "" },
  });
  assert.equal(after.builtinSystemPrompt, before.builtinSystemPrompt);
  assert.equal(after.value.systemPrompt, "");
  assert.equal(after.value.appendSystemPrompt, "CUSTOM_APPEND_MARKER");
  await assert.rejects(readFile(path.join(agentDir, "SYSTEM.md")), { code: "ENOENT" });
});

test("prepares a minimal settings document without overwriting an existing one", async (t) => {
  const { agentDir, service } = await fixture(t);
  const settingsFile = path.join(agentDir, "settings.json");

  assert.equal(await service.prepareDocument(), settingsFile);
  assert.equal(await readFile(settingsFile, "utf8"), "{}\n");

  await writeFile(settingsFile, "{ invalid json");
  assert.equal(await service.prepareDocument(), settingsFile);
  assert.equal(await readFile(settingsFile, "utf8"), "{ invalid json");
});

test("updates the system prompt and compaction settings while preserving unrelated settings", async (t) => {
  const { agentDir, service } = await fixture(t);
  await writeFile(
    path.join(agentDir, "settings.json"),
    `${JSON.stringify({ theme: "dark", compaction: { enabled: false } }, undefined, 2)}\n`,
  );
  const current = (await service.describe()).namespaces[0]!;

  const updated = await service.update({
    ns: PI_AGENT_SETTINGS_NAMESPACE,
    expectedRevision: current.revision,
    patch: {
      systemPrompt: "You are a careful coding assistant.",
      appendSystemPrompt: "Keep responses concise.\n",
      compaction: { enabled: true, reserveTokens: 24_000, keepRecentTokens: 32_000 },
    },
  });

  assert.deepEqual(updated.value, {
    systemPrompt: "You are a careful coding assistant.",
    appendSystemPrompt: "Keep responses concise.\n",
    compaction: { enabled: true, reserveTokens: 24_000, keepRecentTokens: 32_000 },
  });
  assert.notEqual(updated.revision, current.revision);
  assert.equal(
    await readFile(path.join(agentDir, "SYSTEM.md"), "utf8"),
    "You are a careful coding assistant.",
  );
  assert.deepEqual(JSON.parse(await readFile(path.join(agentDir, "settings.json"), "utf8")), {
    theme: "dark",
    compaction: { enabled: true, reserveTokens: 24_000, keepRecentTokens: 32_000 },
  });
  assert.equal(
    await readFile(path.join(agentDir, "APPEND_SYSTEM.md"), "utf8"),
    "Keep responses concise.\n",
  );
});

test("append settings use Pi's native discovery, reload, project precedence, and clearing", async (t) => {
  const { agentDir, service } = await fixture(t);
  const cwd = path.join(agentDir, "project");
  await mkdir(path.join(cwd, ".pi"), { recursive: true });
  const current = (await service.describe()).namespaces[0]!;
  const updated = await service.update({
    ns: PI_AGENT_SETTINGS_NAMESPACE,
    expectedRevision: current.revision,
    patch: { appendSystemPrompt: "Global addition\n" },
  });
  assert.equal(updated.value.systemPrompt, "");
  assert.deepEqual(updated.user, { appendSystemPrompt: "Global addition\n" });
  assert.equal((await service.describe()).hasDocument, true);

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: SettingsManager.inMemory({}, { projectTrusted: true }),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  assert.equal(loader.getSystemPrompt(), undefined);
  assert.deepEqual(loader.getAppendSystemPrompt(), ["Global addition\n"]);

  const custom = await service.update({
    ns: PI_AGENT_SETTINGS_NAMESPACE,
    expectedRevision: updated.revision,
    patch: { systemPrompt: "Custom base" },
  });
  await loader.reload();
  assert.equal(loader.getSystemPrompt(), "Custom base");
  assert.deepEqual(loader.getAppendSystemPrompt(), ["Global addition\n"]);

  const cleared = await service.update({
    ns: PI_AGENT_SETTINGS_NAMESPACE,
    expectedRevision: custom.revision,
    patch: { appendSystemPrompt: " \n" },
  });
  assert.equal(cleared.value.appendSystemPrompt, "");
  assert.equal(cleared.value.systemPrompt, "Custom base");
  await assert.rejects(readFile(path.join(agentDir, "APPEND_SYSTEM.md")), { code: "ENOENT" });
  await loader.reload();
  assert.deepEqual(loader.getAppendSystemPrompt(), []);

  await service.update({
    ns: PI_AGENT_SETTINGS_NAMESPACE,
    patch: { appendSystemPrompt: "Global" },
  });
  await writeFile(path.join(cwd, ".pi", "APPEND_SYSTEM.md"), "Project addition");
  await loader.reload();
  assert.deepEqual(loader.getAppendSystemPrompt(), ["Project addition"]);
  await loader.reload({ resolveProjectTrust: async () => false });
  assert.deepEqual(loader.getAppendSystemPrompt(), ["Global"]);
});

test("external append edits invalidate the revision without overwriting either prompt", async (t) => {
  const { agentDir, service } = await fixture(t);
  await writeFile(path.join(agentDir, "SYSTEM.md"), "Custom base");
  const current = (await service.describe()).namespaces[0]!;
  await writeFile(path.join(agentDir, "APPEND_SYSTEM.md"), "External addition");

  await assert.rejects(
    service.update({
      ns: PI_AGENT_SETTINGS_NAMESPACE,
      expectedRevision: current.revision,
      patch: { appendSystemPrompt: "Stale addition", systemPrompt: "Stale base" },
    }),
    (error) => error instanceof AgentSettingsServiceError && error.code === "settings-conflict",
  );
  const value = (await service.describe()).namespaces[0]!.value;
  assert.equal(value.systemPrompt, "Custom base");
  assert.equal(value.appendSystemPrompt, "External addition");
});

test("prompt scopes isolate project overrides and inherit user prompts after clearing", async (t) => {
  const { agentDir } = await fixture(t);
  const firstProject = path.join(agentDir, "project-one");
  const secondProject = path.join(agentDir, "project-two");
  await mkdir(firstProject);
  await mkdir(secondProject);
  const service = new AgentSettingsService({
    agentDir,
    resolveWorkspaceRoot: async (id) =>
      id === "one" ? firstProject : id === "two" ? secondProject : undefined,
  });
  const user = await service.update({
    ns: PI_AGENT_SETTINGS_NAMESPACE,
    target: { scope: "user" },
    patch: { systemPrompt: "User base", appendSystemPrompt: "User addition" },
  });
  const target = { scope: "project", workspaceId: "one" } as const;
  const initial = (await service.describe(target)).namespaces[0]!;
  assert.equal(initial.value.systemPrompt, "");
  assert.equal(initial.value.appendSystemPrompt, "");
  assert.equal(initial.base?.systemPrompt, "User base");
  assert.equal(initial.base?.appendSystemPrompt, "User addition");
  assert.equal(initial.builtinSystemPrompt, user.builtinSystemPrompt);
  assert.deepEqual(await readdir(firstProject), []);

  const saved = await service.update({
    ns: PI_AGENT_SETTINGS_NAMESPACE,
    target,
    expectedRevision: initial.revision,
    patch: { systemPrompt: "Project base", appendSystemPrompt: "Project addition" },
  });
  assert.equal(saved.value.systemPrompt, "Project base");
  assert.equal(saved.base?.systemPrompt, "User base");
  assert.equal(await readFile(path.join(firstProject, ".pi", "SYSTEM.md"), "utf8"), "Project base");
  assert.equal(
    await readFile(path.join(firstProject, ".pi", "APPEND_SYSTEM.md"), "utf8"),
    "Project addition",
  );
  assert.deepEqual((await service.describe()).namespaces[0]?.value, user.value);
  const other = (await service.describe({ scope: "project", workspaceId: "two" })).namespaces[0]!;
  assert.equal(other.value.systemPrompt, "");
  assert.equal(other.base?.systemPrompt, "User base");
  assert.deepEqual(await readdir(secondProject), []);

  const loader = new DefaultResourceLoader({
    cwd: firstProject,
    agentDir,
    settingsManager: SettingsManager.inMemory({}, { projectTrusted: true }),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  assert.equal(loader.getSystemPrompt(), "Project base");
  assert.deepEqual(loader.getAppendSystemPrompt(), ["Project addition"]);

  await writeFile(path.join(firstProject, ".pi", "APPEND_SYSTEM.md"), "External edit");
  await assert.rejects(
    service.update({
      ns: PI_AGENT_SETTINGS_NAMESPACE,
      target,
      expectedRevision: saved.revision,
      patch: { systemPrompt: "Stale base" },
    }),
    (error) => error instanceof AgentSettingsServiceError && error.code === "settings-conflict",
  );
  const cleared = await service.update({
    ns: PI_AGENT_SETTINGS_NAMESPACE,
    target,
    patch: { systemPrompt: "", appendSystemPrompt: " \n" },
  });
  assert.equal(cleared.value.systemPrompt, "");
  assert.equal(cleared.base?.systemPrompt, "User base");
  assert.deepEqual(await readdir(path.join(firstProject, ".pi")), []);
  await loader.reload();
  assert.equal(loader.getSystemPrompt(), "User base");
  assert.deepEqual(loader.getAppendSystemPrompt(), ["User addition"]);
  assert.deepEqual((await service.describe()).namespaces[0]?.value, user.value);
});

test("unavailable project scopes never fall back to global writes or recreate removed projects", async (t) => {
  const { agentDir } = await fixture(t);
  const removedProject = path.join(agentDir, "removed-project");
  const service = new AgentSettingsService({
    agentDir,
    resolveWorkspaceRoot: async (id) => (id === "removed" ? removedProject : undefined),
  });
  for (const workspaceId of ["unknown", "removed"]) {
    const target = { scope: "project", workspaceId } as const;
    await assert.rejects(service.describe(target));
    await assert.rejects(
      service.update({
        ns: PI_AGENT_SETTINGS_NAMESPACE,
        target,
        patch: {
          systemPrompt: "Must not become global",
          appendSystemPrompt: "Must not become global",
        },
      }),
    );
  }
  await assert.rejects(
    service.update({
      ns: PI_AGENT_SETTINGS_NAMESPACE,
      target: { scope: "project", workspaceId: "unknown" },
      patch: { compaction: { enabled: false } },
    }),
    (error) => error instanceof AgentSettingsServiceError && error.code === "settings-rejected",
  );
  assert.deepEqual(await readdir(agentDir), []);
});

test("an empty system prompt removes the custom override", async (t) => {
  const { agentDir, service } = await fixture(t);
  await writeFile(path.join(agentDir, "SYSTEM.md"), "Custom prompt");
  const current = (await service.describe()).namespaces[0]!;

  const updated = await service.update({
    ns: PI_AGENT_SETTINGS_NAMESPACE,
    expectedRevision: current.revision,
    patch: { systemPrompt: "   \n" },
  });

  assert.equal(updated.value.systemPrompt, "");
  await assert.rejects(readFile(path.join(agentDir, "SYSTEM.md"), "utf8"), {
    code: "ENOENT",
  });
});

test("rejects stale revisions and namespaces outside the exposed Pi agent settings", async (t) => {
  const { service } = await fixture(t);
  const current = (await service.describe()).namespaces[0]!;

  await assert.rejects(
    service.update({
      ns: PI_AGENT_SETTINGS_NAMESPACE,
      expectedRevision: current.revision + 1,
      patch: { compaction: { enabled: false } },
    }),
    (error) => {
      assert.ok(error instanceof AgentSettingsServiceError);
      assert.equal(error.code, "settings-conflict");
      return true;
    },
  );

  await assert.rejects(service.update({ ns: "unknown", patch: {} }), (error) => {
    assert.ok(error instanceof AgentSettingsServiceError);
    assert.equal(error.code, "settings-not-exposed");
    return true;
  });
});

test("does not overwrite malformed global settings", async (t) => {
  const { agentDir, service } = await fixture(t);
  const settingsFile = path.join(agentDir, "settings.json");
  await writeFile(settingsFile, "{ invalid json");

  await assert.rejects(service.describe(), (error) => {
    assert.ok(error instanceof AgentSettingsServiceError);
    assert.equal(error.code, "settings-rejected");
    return true;
  });
  assert.equal(await readFile(settingsFile, "utf8"), "{ invalid json");
});
