import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  bindPiAgentHostBindings,
  getPiAgentHostBindings,
} from "@workbench/agent-runtime-pi-server/installation";
import { createSession } from "@workbench/agent-runtime-pi-server/legacy";
import { subscribeWorkbenchSettingsPreferences } from "@workbench/settings-server/service";
import { getInstalledPiServer } from "../src/composition/installed-pi-server";

test("the installed settings tool validates and persists only current-host preferences", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-settings-tool-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousSettingsFile = process.env.PI_WORKBENCH_SETTINGS_FILE;
  const previousBindings = getPiAgentHostBindings();
  const agentDir = path.join(root, "agent");
  const settingsFile = path.join(root, "custom-settings.json");
  let installed: ReturnType<typeof getInstalledPiServer> | undefined;
  let host: Awaited<ReturnType<typeof createSession>> | undefined;
  let unsubscribe: (() => void) | undefined;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_WORKBENCH_SETTINGS_FILE = settingsFile;
  t.after(async () => {
    unsubscribe?.();
    await host?.shutdown();
    await installed?.dispose();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousSettingsFile === undefined) delete process.env.PI_WORKBENCH_SETTINGS_FILE;
    else process.env.PI_WORKBENCH_SETTINGS_FILE = previousSettingsFile;
    bindPiAgentHostBindings(previousBindings);
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(agentDir);
  const defaultFile = path.join(agentDir, "workbench-settings.json");
  await writeFile(defaultFile, "other installation settings");
  const document = {
    version: 1,
    revision: 4,
    preferences: {
      workbenchSettingsEnabled: true,
      locale: "en-US",
      showReasoning: true,
      appearance: { colorMode: "light", uiFontSize: 16 },
      backgroundImage: { name: "background.png", mimeType: "image/png", data: "AQID" },
      rightWorkspace: { tabs: "private-workspace-state".repeat(40_000) },
      sidebarThreadOrderByScope: { workspace: ["private-thread-id"] },
      fileOpenApps: Object.fromEntries(
        Array.from({ length: 200 }, (_, index) => [`extension:custom${index}`, "system-default"]),
      ),
    },
    workspaces: { workspaces: [] },
    imageUnderstanding: { secrets: { apiKey: "private-test-secret" } },
  };
  await writeFile(settingsFile, JSON.stringify(document));
  installed = getInstalledPiServer();
  host = await createSession(root, "workbench-settings-tool");
  const getTool = () => {
    assert.ok(host);
    const tool = host.session.resourceLoader
      .getExtensions()
      .extensions.find((entry) => entry.path === "<inline:workbench.settings>")
      ?.tools.get("workbench_settings")?.definition;
    assert.ok(tool);
    return tool;
  };
  const invoke = (params: unknown, signal?: AbortSignal, cwd = root) =>
    getTool().execute("settings-test", params, signal, undefined, { cwd } as never);
  const readFullResult = async (result: Awaited<ReturnType<typeof invoke>>) => {
    const text = result.content.find((entry) => entry.type === "text")!.text;
    const summary = JSON.parse(text);
    assert.equal(summary.truncated, true);
    assert.ok(Buffer.byteLength(text) < 50 * 1024);
    assert.ok(text.split("\n").length <= 2000);
    assert.deepEqual(result.details, summary, "details must not retain the full settings snapshot");
    assert.equal(typeof summary.fullOutputPath, "string");
    t.after(() => rm(path.dirname(summary.fullOutputPath), { recursive: true, force: true }));
    const fullText = await readFile(summary.fullOutputPath, "utf8");
    assert.equal(Buffer.byteLength(fullText), summary.totalBytes);
    assert.equal(fullText.split("\n").length, summary.totalLines);
    if (process.platform !== "win32") {
      assert.equal((await stat(summary.fullOutputPath)).mode & 0o777, 0o600);
      assert.equal((await stat(path.dirname(summary.fullOutputPath))).mode & 0o777, 0o700);
    }
    return { summary, value: JSON.parse(fullText) };
  };
  const initial = await invoke({ action: "describe" });
  const initialText = initial.content.find((entry) => entry.type === "text")!.text;
  assert.doesNotMatch(
    initialText,
    /private-test-secret|AQID|workspaces|private-workspace|private-thread/,
  );
  assert.ok(initialText.length < 1_000, "default describe must not dump persisted window state");
  const snapshot = JSON.parse(initialText);
  assert.ok(host.session.getActiveToolNames().includes("workbench_settings"));
  assert.equal(snapshot.revision, 4);
  assert.equal(snapshot.preferences.locale, "en-US");
  assert.deepEqual(snapshot.preferences.backgroundImage, {
    name: "background.png",
    mimeType: "image/png",
  });
  assert.deepEqual(
    new Set(snapshot.omittedKeys),
    new Set(["rightWorkspace", "sidebarThreadOrderByScope", "fileOpenApps"]),
  );
  assert.deepEqual((await invoke({ action: "describe", scope: "user" })).details, initial.details);
  assert.deepEqual((await invoke({ action: "describe", keys: ["locale"] })).details, {
    revision: 4,
    preferences: { locale: "en-US" },
    omittedKeys: [],
  });
  const explicitRead = await invoke({ action: "describe", keys: ["fileOpenApps"] });
  assert.deepEqual(explicitRead.details, {
    revision: 4,
    preferences: { fileOpenApps: document.preferences.fileOpenApps },
    omittedKeys: [],
  });
  const windowState = await invoke({ action: "describe", keys: ["sidebarThreadOrderByScope"] });
  assert.deepEqual(windowState.details, {
    revision: 4,
    preferences: { sidebarThreadOrderByScope: document.preferences.sidebarThreadOrderByScope },
    omittedKeys: [],
  });
  const largeRead = await readFullResult(
    await invoke({ action: "describe", keys: ["rightWorkspace", "backgroundImage"] }),
  );
  assert.equal(largeRead.summary.truncatedBy, "bytes");
  assert.equal(largeRead.summary.revision, 4);
  assert.deepEqual(largeRead.value.preferences, {
    rightWorkspace: document.preferences.rightWorkspace,
    backgroundImage: { name: "background.png", mimeType: "image/png" },
  });
  assert.doesNotMatch(JSON.stringify(largeRead.value), /private-test-secret|AQID/);

  const notifications: unknown[] = [];
  unsubscribe = subscribeWorkbenchSettingsPreferences(settingsFile, (value) =>
    notifications.push(value),
  );
  const updated = await invoke({
    action: "update",
    scope: "user",
    patch: {
      locale: "zh-CN",
      appearance: { ...snapshot.preferences.appearance, colorMode: "dark" },
      todoEnabled: true,
    },
  });
  assert.deepEqual(updated.details, {
    revision: 5,
    preferences: {
      locale: "zh-CN",
      appearance: { colorMode: "dark", uiFontSize: 16 },
      todoEnabled: true,
    },
    omittedKeys: [],
    resetKeys: [],
  });
  assert.equal(notifications.length, 1);
  assert.ok(host.session.getActiveToolNames().includes("todo"));
  const saved = JSON.parse(await readFile(settingsFile, "utf8"));
  assert.equal(saved.revision, 5);
  assert.equal(saved.preferences.locale, "zh-CN");
  assert.deepEqual(saved.preferences.appearance, { colorMode: "dark", uiFontSize: 16 });
  assert.equal(saved.preferences.showReasoning, true);
  assert.deepEqual(saved.workspaces, document.workspaces);
  assert.deepEqual(saved.imageUnderstanding, document.imageUnderstanding);
  assert.deepEqual(saved.preferences.backgroundImage, document.preferences.backgroundImage);
  assert.deepEqual(saved.preferences.rightWorkspace, document.preferences.rightWorkspace);
  assert.equal(await readFile(defaultFile, "utf8"), "other installation settings");

  for (const params of [
    { action: "describe", patch: { locale: "en-US" } },
    { action: "update" },
    { action: "update", patch: { locale: "invalid" } },
    { action: "update", patch: { showReasoning: "false" } },
    { action: "update", patch: { workbenchSettingsEnabled: "false" } },
    { action: "update", patch: { showReasoning: false, unknownPreference: true } },
    { action: "update", scope: "project", patch: { showReasoning: false } },
    { action: "update", expectedRevision: 5, patch: { showReasoning: false } },
    { action: "update", keys: ["locale"], patch: { locale: "en-US" } },
    { action: "describe", scope: "project" },
  ]) {
    await assert.rejects(invoke(params));
  }
  await assert.rejects(
    invoke({ action: "update", patch: { showReasoning: false } }, AbortSignal.abort()),
  );
  assert.deepEqual(JSON.parse(await readFile(settingsFile, "utf8")), saved);

  const resetResult = await invoke({ action: "update", patch: { locale: null } });
  assert.deepEqual(resetResult.details, {
    revision: 6,
    preferences: {},
    omittedKeys: [],
    resetKeys: ["locale"],
  });
  const reset = await getPiAgentHostBindings().workbenchSettings!.describe();
  assert.equal(reset.preferences.locale, undefined);
  assert.equal(reset.preferences.showReasoning, true);
  await host.session.reload();
  assert.ok(getTool());

  const piFile = path.join(agentDir, "settings.json");
  await writeFile(
    piFile,
    JSON.stringify({
      theme: "dark",
      compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
    }),
  );
  const readPi = async (scope = "user") => {
    const result = await invoke({
      action: "describe",
      domain: "pi",
      scope,
      keys: ["systemPrompt", "appendSystemPrompt", "compaction", "showCacheMissNotices"],
    });
    return JSON.parse(result.content.find((entry) => entry.type === "text")!.text);
  };
  const piInitial = await readPi();
  assert.equal(piInitial.ns, "pi.agent");
  assert.deepEqual(piInitial.target, { scope: "user" });
  assert.equal(piInitial.value.systemPrompt, "");
  assert.equal(piInitial.builtinSystemPrompt, undefined);
  const userPrompt = `User base\n${"private-prompt-content ".repeat(1_200)}`;
  await invoke({
    action: "update",
    domain: "pi",
    expectedRevision: piInitial.revision,
    patch: {
      systemPrompt: userPrompt,
      appendSystemPrompt: "User addition",
      compaction: { reserveTokens: 24_000 },
    },
  });
  const piSaved = await readPi();
  assert.equal(piSaved.applies, "restart");
  assert.equal(piSaved.value.systemPrompt, userPrompt);
  assert.equal(piSaved.user, undefined, "prompt values must not be duplicated as raw overrides");
  assert.ok(piSaved.overriddenKeys.includes("systemPrompt"));
  const overview = await invoke({ action: "describe", domain: "pi" });
  const overviewText = overview.content.find((entry) => entry.type === "text")!.text;
  assert.ok(overviewText.length < 1_000);
  assert.doesNotMatch(overviewText, /private-prompt-content|User addition/);
  assert.deepEqual(JSON.parse(overviewText).omittedKeys, ["systemPrompt", "appendSystemPrompt"]);
  const compactionRead = await invoke({ action: "describe", domain: "pi", keys: ["compaction"] });
  assert.deepEqual(compactionRead.details, {
    ns: "pi.agent",
    target: { scope: "user" },
    revision: piSaved.revision,
    value: { compaction: piSaved.value.compaction },
    base: { compaction: piSaved.base.compaction },
    overriddenKeys: piSaved.overriddenKeys,
    omittedKeys: [],
    applies: "restart",
  });
  const piUpdate = await invoke({
    action: "update",
    domain: "pi",
    expectedRevision: piSaved.revision,
    patch: { compaction: { reserveTokens: 24_000 } },
  });
  assert.deepEqual(piUpdate.details, compactionRead.details);
  assert.equal(await readFile(path.join(agentDir, "APPEND_SYSTEM.md"), "utf8"), "User addition");
  assert.deepEqual(JSON.parse(await readFile(piFile, "utf8")), {
    theme: "dark",
    compaction: { enabled: true, reserveTokens: 24_000, keepRecentTokens: 20_000 },
  });
  for (const patch of [
    { compaction: { enabled: "false" } },
    { compaction: { reserveTokens: 0 } },
    { compaction: { keepRecentTokens: 10_000_001 } },
    { compaction: { unknownField: 1 } },
    { systemPrompt: null },
    { systemPrompt: "Must not be saved", unknownField: true },
  ]) {
    await assert.rejects(
      invoke({ action: "update", domain: "pi", expectedRevision: piSaved.revision, patch }),
    );
  }
  await assert.rejects(
    invoke({ action: "update", domain: "pi", patch: { systemPrompt: "Missing revision" } }),
    /expectedRevision/,
  );
  await assert.rejects(
    invoke({
      action: "update",
      domain: "pi",
      expectedRevision: piInitial.revision,
      patch: { systemPrompt: "Stale" },
    }),
    /changed before/,
  );
  await assert.rejects(
    invoke(
      {
        action: "update",
        domain: "pi",
        expectedRevision: piSaved.revision,
        patch: { systemPrompt: "Cancelled" },
      },
      AbortSignal.abort(),
    ),
  );
  assert.deepEqual(await readPi(), piSaved);
  await assert.rejects(readPi("project"), /registered project/);

  const workspaceResponse = await installed.handleRpcPost(
    new Request("http://127.0.0.1/api/workspace.create", {
      method: "POST",
      headers: { host: "127.0.0.1", "content-type": "application/json" },
      body: JSON.stringify({
        type: "client-request",
        rpcId: "settings-project",
        method: "workspace.create",
        payload: { path: root },
      }),
    }),
    "workspace.create",
  );
  const workspaceResult = await workspaceResponse.json();
  assert.equal(workspaceResult.result.ok, true);
  const workbenchBeforePi = await readFile(settingsFile, "utf8");
  const projectInitial = await readPi("project");
  assert.deepEqual(projectInitial.target, {
    scope: "project",
    workspaceId: workspaceResult.result.value.workspace.workspaceId,
  });
  assert.equal(projectInitial.base.systemPrompt, userPrompt);
  assert.deepEqual(projectInitial.overriddenKeys, []);
  const projectOverview = await invoke({ action: "describe", domain: "pi", scope: "project" });
  assert.doesNotMatch(JSON.stringify(projectOverview), /private-prompt-content/);
  await invoke({
    action: "update",
    domain: "pi",
    scope: "project",
    expectedRevision: projectInitial.revision,
    patch: { systemPrompt: "Project base", appendSystemPrompt: "Project addition" },
  });
  const projectSaved = await readPi("project");
  assert.equal(await readFile(path.join(root, ".pi", "SYSTEM.md"), "utf8"), "Project base");
  assert.equal(
    await readFile(path.join(root, ".pi", "APPEND_SYSTEM.md"), "utf8"),
    "Project addition",
  );
  await assert.rejects(
    invoke({
      action: "update",
      domain: "pi",
      scope: "project",
      expectedRevision: projectSaved.revision,
      patch: { compaction: { enabled: false } },
    }),
    /Project prompt settings/,
  );
  await assert.rejects(
    invoke({
      action: "update",
      domain: "pi",
      scope: "project",
      expectedRevision: projectInitial.revision,
      patch: { systemPrompt: "Stale project" },
    }),
    /changed before/,
  );
  await assert.rejects(
    invoke(
      {
        action: "update",
        domain: "pi",
        scope: "project",
        expectedRevision: piSaved.revision,
        patch: { systemPrompt: "Unregistered project" },
      },
      undefined,
      agentDir,
    ),
    /registered project/,
  );
  await invoke({
    action: "update",
    domain: "pi",
    scope: "project",
    expectedRevision: projectSaved.revision,
    patch: { systemPrompt: "", appendSystemPrompt: "" },
  });
  await assert.rejects(readFile(path.join(root, ".pi", "SYSTEM.md")), { code: "ENOENT" });
  const projectReset = await readPi("project");
  assert.equal(projectReset.base.systemPrompt, userPrompt);
  assert.equal(projectReset.value.systemPrompt, "");
  assert.deepEqual(await readPi(), piSaved);
  assert.equal(await readFile(settingsFile, "utf8"), workbenchBeforePi);
  await assert.rejects(readFile(path.join(agentDir, "trust.json")), { code: "ENOENT" });
  await host.session.reload();
  assert.ok(host.session.systemPrompt.includes("User base"));
  assert.ok(host.session.systemPrompt.includes("User addition"));

  await invoke({ action: "update", patch: { workbenchSettingsEnabled: false } });
  assert.ok(!host.session.getActiveToolNames().includes("workbench_settings"));
  await assert.rejects(invoke({ action: "describe" }), /disabled/);
  await getPiAgentHostBindings().workbenchSettings!.update({
    patch: { workbenchSettingsEnabled: true },
  });
  assert.ok(host.session.getActiveToolNames().includes("workbench_settings"));

  const expandedIds = Array.from({ length: 2100 }, (_, index) => String(index));
  const largeUpdate = await readFullResult(
    await invoke({ action: "update", patch: { rightWorkspace: { rows: expandedIds } } }),
  );
  assert.equal(largeUpdate.summary.truncatedBy, "lines");
  assert.ok(largeUpdate.summary.totalBytes < 50 * 1024, "line limits must apply independently");
  assert.deepEqual(largeUpdate.value.preferences.rightWorkspace.rows, expandedIds);
  assert.deepEqual(
    (await getPiAgentHostBindings().workbenchSettings!.describe()).preferences.rightWorkspace?.rows,
    expandedIds,
  );

  const unicodePrompt = "设置".repeat(10_000);
  assert.ok(unicodePrompt.length < 50 * 1024);
  const unicodeUpdate = await readFullResult(
    await invoke({
      action: "update",
      domain: "pi",
      expectedRevision: (await readPi()).revision,
      patch: { systemPrompt: unicodePrompt },
    }),
  );
  assert.equal(unicodeUpdate.summary.truncatedBy, "bytes", "limits must count UTF-8 bytes");
  assert.equal(unicodeUpdate.summary.applies, "restart");
  assert.equal(unicodeUpdate.value.value.systemPrompt, unicodePrompt);
  const unicodeRead = await readFullResult(
    await invoke({ action: "describe", domain: "pi", keys: ["systemPrompt"] }),
  );
  assert.equal(unicodeRead.value.value.systemPrompt, unicodePrompt);

  // A failed output spill must not disguise a committed update as a failed settings write.
  const tempKeys = ["TMPDIR", "TMP", "TEMP"];
  const previousTemp = tempKeys.map((key) => process.env[key]);
  try {
    for (const key of tempKeys) process.env[key] = settingsFile;
    const failedSpill = await invoke({
      action: "update",
      patch: { rightWorkspace: { rows: [...expandedIds, "saved-despite-spill-failure"] } },
    });
    const output = JSON.parse(failedSpill.content.find((entry) => entry.type === "text")!.text);
    assert.equal(output.truncated, true);
    assert.equal(output.fullOutputPath, undefined);
    assert.match(output.outputError, /operation completed.*do not repeat the update/i);
    const persisted = await getPiAgentHostBindings().workbenchSettings!.describe();
    assert.equal(output.revision, persisted.revision);
    assert.deepEqual(persisted.preferences.rightWorkspace?.rows, [
      ...expandedIds,
      "saved-despite-spill-failure",
    ]);

    const cancelledOutputDir = path.join(root, "cancelled-output");
    await mkdir(cancelledOutputDir);
    for (const key of tempKeys) process.env[key] = cancelledOutputDir;
    const controller = new AbortController();
    const describe = t.mock.method(
      getPiAgentHostBindings().workbenchSettings!,
      "describe",
      async () => {
        controller.abort();
        return persisted;
      },
    );
    try {
      const cancelled = await invoke(
        { action: "describe", keys: ["rightWorkspace"] },
        controller.signal,
      );
      const output = JSON.parse(cancelled.content.find((entry) => entry.type === "text")!.text);
      assert.match(output.outputError, /cancelled/);
      assert.equal(output.revision, persisted.revision);
      assert.equal(output.fullOutputPath, undefined);
      assert.deepEqual(
        await readdir(cancelledOutputDir),
        [],
        "cancelled spills must clean incomplete files",
      );
    } finally {
      describe.mock.restore();
    }
  } finally {
    for (const [index, key] of tempKeys.entries()) {
      if (previousTemp[index] === undefined) delete process.env[key];
      else process.env[key] = previousTemp[index];
    }
  }

  await writeFile(settingsFile, "invalid json");
  await assert.rejects(invoke({ action: "update", patch: { locale: "en-US" } }));
  assert.equal(await readFile(settingsFile, "utf8"), "invalid json");
  await writeFile(settingsFile, JSON.stringify(saved));
  bindPiAgentHostBindings({});
  await assert.rejects(invoke({ action: "describe" }), /unavailable/);
});
