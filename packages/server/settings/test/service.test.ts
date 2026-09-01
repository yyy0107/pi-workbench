import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { SUPPORTED_LOCALES, type Locale } from "@workbench/contracts/locale";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      !/\.[^/]+$/.test(specifier) &&
      context.parentURL?.includes("/packages/server/settings/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { WorkbenchSettingsService } = (await import(
  new URL("../src/service.ts", import.meta.url).href
)) as typeof import("../src/service");
const { subscribeWorkbenchSettingsPreferences } = (await import(
  new URL("../src/service.ts", import.meta.url).href
)) as typeof import("../src/service");
const { configuredWorkbenchSettingsFile } = (await import(
  new URL("../src/file.ts", import.meta.url).href
)) as typeof import("../src/file");
moduleHooks.deregister();

test("resolves persistence from injected Host configuration", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-settings-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  assert.equal(
    configuredWorkbenchSettingsFile({ defaultDirectory: root }),
    path.join(root, "workbench-settings.json"),
  );
  assert.equal(
    configuredWorkbenchSettingsFile({
      defaultDirectory: path.join(root, "unused"),
      configuredFile: path.join(root, "configured.json"),
    }),
    path.join(root, "configured.json"),
  );
});

test("describes empty preferences without mutating the agent directory", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-settings-readonly-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateFile = path.join(root, "agent", "workbench-settings.json");
  const service = new WorkbenchSettingsService({ stateFile });

  assert.deepEqual(await service.describe(), { revision: 0, preferences: {} });
  await assert.rejects(readFile(stateFile, "utf8"), { code: "ENOENT" });
});

test("prepares a minimal Workbench settings document without overwriting an existing one", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-settings-document-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateFile = path.join(root, "agent", "workbench-settings.json");
  const service = new WorkbenchSettingsService({ stateFile });

  assert.equal(await service.prepareDocument(), stateFile);
  assert.deepEqual(JSON.parse(await readFile(stateFile, "utf8")), { version: 1, revision: 0 });

  await writeFile(stateFile, "{ invalid json");
  assert.equal(await service.prepareDocument(), stateFile);
  assert.equal(await readFile(stateFile, "utf8"), "{ invalid json");
});

test("persists every shared locale and rejects unsupported locale values", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-settings-locales-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new WorkbenchSettingsService({
    stateFile: path.join(root, "agent", "workbench-settings.json"),
  });

  for (const locale of SUPPORTED_LOCALES) {
    await service.update({ patch: { locale } });
    assert.equal((await service.describe()).preferences.locale, locale);
  }

  await assert.rejects(service.update({ patch: { locale: "en" as Locale } }), {
    name: "WorkbenchSettingsServiceError",
    code: "workbench-settings-invalid",
  });
  assert.equal(
    (await service.describe()).preferences.locale,
    SUPPORTED_LOCALES[SUPPORTED_LOCALES.length - 1],
  );
});

test("persists sidebar conversation sorting preferences across service instances", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-settings-sidebar-order-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateFile = path.join(root, "agent", "workbench-settings.json");
  const first = new WorkbenchSettingsService({ stateFile });

  await first.update({
    patch: {
      sidebarThreadSortMode: "manual",
      sidebarExpandedWorkspaceIds: ["workspace-1", "workspace-2"],
      sidebarSelectedThreadId: "session-c",
      sidebarThreadOrderByScope: {
        pinned: ["session-b", "session-a"],
        "workspace:workspace-1": ["session-c", "session-d"],
      },
      toolboxScope: { kind: "project", workspaceId: "workspace-1" },
    },
  });

  const second = new WorkbenchSettingsService({ stateFile });
  assert.deepEqual((await second.describe()).preferences, {
    sidebarThreadSortMode: "manual",
    sidebarExpandedWorkspaceIds: ["workspace-1", "workspace-2"],
    sidebarSelectedThreadId: "session-c",
    sidebarThreadOrderByScope: {
      pinned: ["session-b", "session-a"],
      "workspace:workspace-1": ["session-c", "session-d"],
    },
    toolboxScope: { kind: "project", workspaceId: "workspace-1" },
  });
});

test("persists Ask User capability updates and notifies matching live sessions", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-settings-ask-user-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateFile = path.join(root, "agent", "workbench-settings.json");
  const unrelatedStateFile = path.join(root, "other", "workbench-settings.json");
  const service = new WorkbenchSettingsService({ stateFile });
  const observed: boolean[] = [];
  const unrelated: boolean[] = [];
  const unsubscribe = subscribeWorkbenchSettingsPreferences(stateFile, (preferences) => {
    observed.push(preferences.askUserEnabled ?? true);
  });
  const unsubscribeUnrelated = subscribeWorkbenchSettingsPreferences(
    unrelatedStateFile,
    (preferences) => unrelated.push(preferences.askUserEnabled ?? true),
  );
  t.after(() => {
    unsubscribe();
    unsubscribeUnrelated();
  });

  await service.update({ patch: { askUserEnabled: false } });
  await service.update({ patch: { askUserEnabled: false } });
  await service.update({ patch: { askUserEnabled: true } });

  assert.equal(
    (await new WorkbenchSettingsService({ stateFile }).describe()).preferences.askUserEnabled,
    true,
  );
  assert.deepEqual(observed, [false, true]);
  assert.deepEqual(unrelated, []);
});
