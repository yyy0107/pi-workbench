import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      locale: "en-US",
      showReasoning: true,
      appearance: { colorMode: "light", uiFontSize: 16 },
      backgroundImage: { name: "background.png", mimeType: "image/png", data: "AQID" },
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
    assert.ok(host.session.getActiveToolNames().includes(tool.name));
    return tool;
  };
  const invoke = (params: unknown, signal?: AbortSignal, cwd = root) =>
    getTool().execute("settings-test", params, signal, undefined, { cwd } as never);
  const initial = await invoke({ action: "describe" });
  const initialText = initial.content.find((entry) => entry.type === "text")!.text;
  assert.doesNotMatch(initialText, /private-test-secret|AQID|workspaces/);
  const snapshot = JSON.parse(initialText);
  assert.equal(snapshot.revision, 4);
  assert.equal(snapshot.preferences.locale, "en-US");
  assert.deepEqual(snapshot.preferences.backgroundImage, {
    name: "background.png",
    mimeType: "image/png",
  });

  const notifications: unknown[] = [];
  unsubscribe = subscribeWorkbenchSettingsPreferences(settingsFile, (value) =>
    notifications.push(value),
  );
  await invoke({
    action: "update",
    patch: {
      locale: "zh-CN",
      appearance: { ...snapshot.preferences.appearance, colorMode: "dark" },
      todoEnabled: true,
    },
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
  assert.equal(await readFile(defaultFile, "utf8"), "other installation settings");

  for (const params of [
    { action: "describe", patch: { locale: "en-US" } },
    { action: "update" },
    { action: "update", patch: { locale: "invalid" } },
    { action: "update", patch: { showReasoning: "false" } },
    { action: "update", patch: { showReasoning: false, unknownPreference: true } },
    { action: "update", scope: "project", patch: { showReasoning: false } },
    { action: "update", expectedRevision: 5, patch: { showReasoning: false } },
  ]) {
    await assert.rejects(invoke(params));
  }
  await assert.rejects(
    invoke({ action: "update", patch: { showReasoning: false } }, AbortSignal.abort()),
  );
  assert.deepEqual(JSON.parse(await readFile(settingsFile, "utf8")), saved);

  await invoke({ action: "update", patch: { locale: null } });
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
    const result = await invoke({ action: "describe", domain: "pi", scope });
    return JSON.parse(result.content.find((entry) => entry.type === "text")!.text);
  };
  const piInitial = await readPi();
  assert.equal(piInitial.ns, "pi.agent");
  assert.deepEqual(piInitial.target, { scope: "user" });
  assert.equal(piInitial.value.systemPrompt, "");
  assert.equal(piInitial.builtinSystemPrompt, undefined);
  await invoke({
    action: "update",
    domain: "pi",
    expectedRevision: piInitial.revision,
    patch: {
      systemPrompt: "User base",
      appendSystemPrompt: "User addition",
      compaction: { reserveTokens: 24_000 },
    },
  });
  const piSaved = await readPi();
  assert.equal(piSaved.applies, "restart");
  assert.equal(piSaved.value.systemPrompt, "User base");
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
  assert.equal(projectInitial.base.systemPrompt, "User base");
  assert.deepEqual(projectInitial.user, {});
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
  assert.equal(projectReset.base.systemPrompt, "User base");
  assert.equal(projectReset.value.systemPrompt, "");
  assert.deepEqual(await readPi(), piSaved);
  assert.equal(await readFile(settingsFile, "utf8"), workbenchBeforePi);
  await assert.rejects(readFile(path.join(agentDir, "trust.json")), { code: "ENOENT" });
  await host.session.reload();
  assert.ok(host.session.systemPrompt.includes("User base"));
  assert.ok(host.session.systemPrompt.includes("User addition"));

  await writeFile(settingsFile, "invalid json");
  await assert.rejects(invoke({ action: "update", patch: { locale: "en-US" } }));
  assert.equal(await readFile(settingsFile, "utf8"), "invalid json");
  await writeFile(settingsFile, JSON.stringify(saved));
  bindPiAgentHostBindings({});
  await assert.rejects(invoke({ action: "describe" }), /unavailable/);
});
