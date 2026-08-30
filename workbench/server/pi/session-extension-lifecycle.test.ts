import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { WorkbenchSettingsPreferences } from "@workbench/agent-runtime-contracts/settings";

test("host shutdown releases extension preference listeners before ctx becomes stale", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-session-extension-lifecycle-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousSettingsFile = process.env.PI_WORKBENCH_SETTINGS_FILE;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  process.env.PI_WORKBENCH_SETTINGS_FILE = path.join(root, "agent", "workbench-settings.json");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousSettingsFile === undefined) delete process.env.PI_WORKBENCH_SETTINGS_FILE;
    else process.env.PI_WORKBENCH_SETTINGS_FILE = previousSettingsFile;
  });

  const [
    { createSession },
    { WorkbenchSettingsService, subscribeWorkbenchSettingsPreferences },
    { bindPiAgentHostBindings, getPiAgentHostBindings },
  ] = await Promise.all([
    import("@workbench/agent-runtime-pi-server/legacy"),
    import("@/runtime/server/settings/workbench-settings-service"),
    import("@workbench/agent-runtime-pi-server/installation"),
  ]);
  const settings = new WorkbenchSettingsService({
    stateFile: process.env.PI_WORKBENCH_SETTINGS_FILE!,
  });
  const previousHostBindings = getPiAgentHostBindings();
  bindPiAgentHostBindings({
    ...previousHostBindings,
    askUserSettings: {
      async readEnabled() {
        return (await settings.describe()).preferences.askUserEnabled !== false;
      },
      subscribe(listener: (enabled: boolean) => void) {
        return subscribeWorkbenchSettingsPreferences(
          settings.stateFile,
          (preferences: WorkbenchSettingsPreferences) => {
            listener(preferences.askUserEnabled !== false);
          },
        );
      },
    },
  });
  t.after(() => bindPiAgentHostBindings(previousHostBindings));

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const host = await createSession(cwd, "extension-lifecycle");
  t.after(() => host.shutdown());
  assert.equal(host.session.getActiveToolNames().includes("ask_user"), true);

  const errors: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  t.after(() => {
    console.error = originalConsoleError;
  });

  await settings.update({ patch: { askUserEnabled: false } });
  assert.equal(host.session.getActiveToolNames().includes("ask_user"), false);

  await host.shutdown();
  await settings.update({ patch: { askUserEnabled: true } });

  assert.deepEqual(errors, []);
});
