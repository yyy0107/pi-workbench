import assert from "node:assert/strict";
import test from "node:test";
import { WorkbenchAgentCapabilityError } from "@workbench/agent-runtime-client/capabilities";

import { createWorkbenchSettingsClient } from "../src/settings";

test("the public settings factory snapshots caller transport options", async () => {
  const used: string[] = [];
  const transport =
    (label: string, locale: "en-US" | "zh-CN") => async (_path: string, init?: RequestInit) => {
      used.push(label);
      const request = JSON.parse(String(init?.body)) as { rpcId: string };
      return Response.json({
        type: "server-response",
        rpcId: request.rpcId,
        result: {
          ok: true,
          value: { revision: 1, preferences: { locale } },
        },
      });
    };
  const callerOptions: {
    transport?: ReturnType<typeof transport>;
  } = { transport: transport("first", "en-US") };
  const client = createWorkbenchSettingsClient(callerOptions);

  callerOptions.transport = transport("retargeted", "zh-CN");

  assert.deepEqual(await client.load(), { locale: "en-US" });
  assert.deepEqual(used, ["first"]);
});

test("load waits for an in-flight mutation before exposing the installation snapshot", async () => {
  let releaseUpdate: (() => void) | undefined;
  let updateStarted: (() => void) | undefined;
  const updateDidStart = new Promise<void>((resolve) => {
    updateStarted = resolve;
  });
  const transport = async (_path: string, init?: RequestInit): Promise<Response> => {
    const request = JSON.parse(String(init?.body)) as {
      method: string;
      rpcId: string;
    };
    if (request.method === "workbenchSettings.describe") {
      return Response.json({
        type: "server-response",
        rpcId: request.rpcId,
        result: {
          ok: true,
          value: { revision: 1, preferences: { rightWorkspace: { width: 500 } } },
        },
      });
    }
    if (request.method === "workbenchSettings.update") {
      updateStarted?.();
      await new Promise<void>((resolve) => {
        releaseUpdate = resolve;
      });
      return Response.json({
        type: "server-response",
        rpcId: request.rpcId,
        result: { ok: true, value: { revision: 2 } },
      });
    }
    throw new Error(`Unexpected RPC method: ${request.method}`);
  };
  const client = createWorkbenchSettingsClient({ transport });

  assert.deepEqual(await client.load(), { rightWorkspace: { width: 500 } });
  const update = client.update({ rightWorkspace: { width: 700 } });
  await updateDidStart;

  let loadSettled = false;
  const load = client.load().then((preferences) => {
    loadSettled = true;
    return preferences;
  });
  await Promise.resolve();
  assert.equal(loadSettled, false);

  releaseUpdate?.();
  await update;
  assert.deepEqual(await load, { rightWorkspace: { width: 700 } });
});

test("updates remain ordered after a failed write and only successful patches enter the cache", async () => {
  let signalStarted!: () => void;
  let releaseWrite!: () => void;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const patches: unknown[] = [];
  let loads = 0;
  const client = createWorkbenchSettingsClient({
    transport: async (_path, init) => {
      const request = JSON.parse(String(init?.body));
      const response = (result: unknown) =>
        Response.json({ type: "server-response", rpcId: request.rpcId, result });
      if (request.method === "workbenchSettings.describe") {
        loads++;
        return response({ ok: true, value: { revision: 0, preferences: { locale: "en-US" } } });
      }
      patches.push(request.payload.patch);
      if (patches.length === 1) {
        signalStarted();
        await released;
        return response({
          ok: false,
          error: { code: "workbench-settings-conflict", message: "Conflict", details: {} },
        });
      }
      return response({ ok: true, value: { revision: patches.length } });
    },
  });
  await Promise.all([client.load(), client.load()]);
  assert.equal(loads, 1);
  const first = client.update({ locale: "zh-CN" });
  const failed = assert.rejects(
    first,
    (error) => error instanceof WorkbenchAgentCapabilityError && error.code === "conflict",
  );
  const second = client.update({ sidebarOpen: false });
  const third = client.update({ sidebarOpen: true });
  await started;
  assert.deepEqual(patches, [{ locale: "zh-CN" }]);
  releaseWrite();
  await Promise.all([failed, second, third]);
  assert.deepEqual(patches, [{ locale: "zh-CN" }, { sidebarOpen: false }, { sidebarOpen: true }]);
  assert.deepEqual(await client.load(), { locale: "en-US", sidebarOpen: true });
});
