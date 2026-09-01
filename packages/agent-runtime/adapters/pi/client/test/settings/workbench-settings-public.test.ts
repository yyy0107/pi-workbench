import assert from "node:assert/strict";
import test from "node:test";

import { createPiWorkbenchSettingsClient } from "../../src/public/workbench-settings";

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
  const client = createPiWorkbenchSettingsClient(callerOptions);

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
  const client = createPiWorkbenchSettingsClient({ transport });

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
