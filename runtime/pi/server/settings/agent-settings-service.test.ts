import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const { PI_AGENT_SETTINGS_NAMESPACE } = (await import(
  new URL("../../contracts/rpc.ts", import.meta.url).href
)) as typeof import("@/runtime/pi/contracts/rpc");
const { AgentSettingsService, AgentSettingsServiceError } = (await import(
  new URL("./agent-settings-service.ts", import.meta.url).href
)) as typeof import("./agent-settings-service");
moduleHooks.deregister();

async function fixture(t: test.TestContext) {
  const agentDir = await mkdtemp(path.join(tmpdir(), "workbench-agent-settings-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  return { agentDir, service: new AgentSettingsService({ agentDir }) };
}

test("describes Pi defaults when no global agent settings exist", async (t) => {
  const { service } = await fixture(t);
  const described = await service.describe();

  assert.equal(described.writable, true);
  assert.equal(described.hasDocument, false);
  assert.equal(described.namespaces.length, 1);
  assert.deepEqual(described.namespaces[0]?.value, {
    systemPrompt: "",
    compaction: {
      enabled: true,
      reserveTokens: 16_384,
      keepRecentTokens: 20_000,
    },
  });
  assert.deepEqual(described.namespaces[0]?.user, {});
  assert.equal(described.namespaces[0]?.applies, "restart");
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
      compaction: { enabled: true, reserveTokens: 24_000, keepRecentTokens: 32_000 },
    },
  });

  assert.deepEqual(updated.value, {
    systemPrompt: "You are a careful coding assistant.",
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
