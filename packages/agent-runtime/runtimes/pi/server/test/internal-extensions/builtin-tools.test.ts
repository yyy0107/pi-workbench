import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  builtinToolEnabled,
  type WorkbenchSettingsPreferences,
} from "@workbench/agent-runtime-contracts/settings";
import {
  WorkbenchSettingsService,
  subscribeWorkbenchSettingsPreferences,
} from "@workbench/settings-server/service";
import {
  createBuiltinToolExtensions,
  workbenchToolOverrides,
} from "../../src/internal-extensions/builtin-tools";
import { ExtensionService } from "../../src/extensions/extension-service";

test("native tools are discoverable, persisted, live-switchable, and restored after reload", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "builtin-tools-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const settings = new WorkbenchSettingsService({
    stateFile: path.join(cwd, "workbench-settings.json"),
  });
  await settings.update({ patch: { enhancedSearch: true, grepToolEnabled: false } });
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const overrides = workbenchToolOverrides(cwd, {}, true);
  const workbenchToolSources = new Map(overrides.map(({ name, source }) => [name, source]));
  const create = async () => {
    const settingsManager = SettingsManager.inMemory();
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: cwd,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      extensionFactories: createBuiltinToolExtensions((name) => ({
        readEnabled: async () => builtinToolEnabled(name, (await settings.describe()).preferences),
        subscribe: (listener) =>
          subscribeWorkbenchSettingsPreferences(settings.stateFile, (preferences) =>
            listener(builtinToolEnabled(name, preferences)),
          ),
      })),
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd,
      agentDir: cwd,
      settingsManager,
      resourceLoader,
      modelRuntime,
      sessionManager: SessionManager.inMemory(cwd),
      customTools: overrides.map((override) => override.create({ cwd, sessionId: "test" })),
    });
    await session.bindExtensions({ mode: "rpc" });
    t.after(() => session.dispose());
    return session;
  };
  const session = await create();
  assert.deepEqual(
    new Set(session.getActiveToolNames()),
    new Set(["read", "bash", "edit", "write", "find"]),
  );
  const catalog = await new ExtensionService({
    getSession: async () => ({ session, workbenchToolSources }),
  }).list({
    sessionId: session.sessionId,
  });
  assert.deepEqual(catalog.builtins?.flatMap((entry) => entry.toolNames).sort(), [
    "bash",
    "edit",
    "find",
    "grep",
    "ls",
    "read",
    "write",
  ]);
  assert.ok(
    catalog.builtins?.every(
      (entry) => JSON.parse(entry.toolDetails[0].parameterSchemaJson!).type === "object",
    ),
  );
  assert.deepEqual(
    catalog.builtins?.find((entry) => entry.toolNames.includes("read"))?.provenance,
    {
      kind: "pi-builtin",
      source: "@earendil-works/pi-coding-agent",
    },
  );
  assert.deepEqual(
    catalog.builtins?.find((entry) => entry.toolNames.includes("grep"))?.provenance,
    {
      kind: "workbench",
      source: "workbench.enhanced-search",
      overridesPiBuiltin: true,
    },
  );
  assert.match(
    catalog.builtins?.find((entry) => entry.toolNames.includes("grep"))?.toolDetails[0]
      .parameterSchemaJson ?? "",
    /"paths"/,
  );
  const sdkCatalog = await new ExtensionService({ getSession: async () => ({ session }) }).list({
    sessionId: session.sessionId,
  });
  assert.equal(
    sdkCatalog.builtins?.find((entry) => entry.toolNames.includes("grep"))?.provenance?.kind,
    "custom",
  );
  assert.match(
    JSON.stringify(session.getAllTools().find((tool) => tool.name === "grep")?.parameters),
    /"paths"/,
  );
  await settings.update({
    patch: { readToolEnabled: false, lsToolEnabled: true, grepToolEnabled: true },
  });
  assert.ok(!session.getActiveToolNames().includes("read"));
  assert.ok(session.getActiveToolNames().includes("ls"));
  assert.ok(session.getActiveToolNames().includes("grep"));
  assert.equal(
    (
      await session.extensionRunner.emitToolCall({
        type: "tool_call",
        toolName: "read",
        toolCallId: "disabled-read",
        input: { path: "file.txt" },
      })
    )?.block,
    true,
  );
  await settings.update({ patch: { readToolEnabled: true } });
  assert.equal(
    await session.extensionRunner.emitToolCall({
      type: "tool_call",
      toolName: "read",
      toolCallId: "enabled-read",
      input: { path: "file.txt" },
    }),
    undefined,
  );
  await settings.update({ patch: { readToolEnabled: false } });
  await session.reload();
  assert.ok(!session.getActiveToolNames().includes("read"));
  assert.ok(session.getActiveToolNames().includes("ls"));
  const restored = await create();
  assert.deepEqual(new Set(restored.getActiveToolNames()), new Set(session.getActiveToolNames()));
  await assert.rejects(
    settings.update({ patch: { lsToolEnabled: "yes" } as unknown as WorkbenchSettingsPreferences }),
    /invalid/,
  );
});
