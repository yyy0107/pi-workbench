import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_CONNECTION_PROTOCOL_VERSION,
  defineRuntimeConnection,
  type RuntimeConnection,
} from "@workbench/host-contracts";

import { createInstalledAgentRuntimeTransport } from "../src/installation";
import { createInstalledWorkbenchSettingsService } from "../src/settings";

function desktopConnection(port: number, accessToken: string): RuntimeConnection {
  return defineRuntimeConnection({
    kind: "desktop-sidecar",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    httpOrigin: `http://127.0.0.1:${port}`,
    instanceId: "shared-instance-id",
    accessToken,
  });
}

test("settings and the Pi installation derive URL and bearer identity from one descriptor", async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const connection = desktopConnection(43_201, "shared-secret");
  const fetchImplementation = async (input: URL, init?: RequestInit) => {
    calls.push({
      url: input.href,
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    const request = init?.body ? (JSON.parse(String(init.body)) as { rpcId: string }) : undefined;
    return request
      ? Response.json({
          type: "server-response",
          rpcId: request.rpcId,
          result: { ok: true, value: { revision: 1, preferences: { locale: "en-US" } } },
        })
      : Response.json({});
  };
  const settings = createInstalledWorkbenchSettingsService(connection, fetchImplementation);
  const agentTransport = createInstalledAgentRuntimeTransport(connection, { fetchImplementation });

  await settings.load();
  await agentTransport.http("/api/host.describe");

  assert.deepEqual(calls, [
    {
      url: "http://127.0.0.1:43201/api/workbenchSettings.describe",
      authorization: "Bearer shared-secret",
    },
    {
      url: "http://127.0.0.1:43201/api/host.describe",
      authorization: "Bearer shared-secret",
    },
  ]);
});

test("same-instance-id settings installations isolate snapshots and mutation queues", async () => {
  let releaseFirstUpdate: (() => void) | undefined;
  const methods = { first: [] as string[], second: [] as string[] };
  const createFetch =
    (label: "first" | "second", port: number, token: string) =>
    async (input: URL, init?: RequestInit) => {
      assert.equal(input.origin, `http://127.0.0.1:${port}`);
      assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${token}`);
      const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
      methods[label].push(request.method);
      if (label === "first" && request.method === "workbenchSettings.update") {
        await new Promise<void>((resolve) => {
          releaseFirstUpdate = resolve;
        });
      }
      return Response.json({
        type: "server-response",
        rpcId: request.rpcId,
        result: {
          ok: true,
          value:
            request.method === "workbenchSettings.describe"
              ? {
                  revision: 1,
                  preferences: { locale: label === "first" ? "en-US" : "zh-CN" },
                }
              : { revision: 2 },
        },
      });
    };
  const first = createInstalledWorkbenchSettingsService(
    desktopConnection(43_202, "first-secret"),
    createFetch("first", 43_202, "first-secret"),
  );
  const second = createInstalledWorkbenchSettingsService(
    desktopConnection(43_203, "second-secret"),
    createFetch("second", 43_203, "second-secret"),
  );

  assert.deepEqual(await first.load(), { locale: "en-US" });
  assert.deepEqual(await second.load(), { locale: "zh-CN" });
  const firstUpdate = first.update({ sidebarOpen: false });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await second.update({ sidebarOpen: true });

  assert.deepEqual(methods.second, ["workbenchSettings.describe", "workbenchSettings.update"]);
  assert.ok(releaseFirstUpdate);
  releaseFirstUpdate();
  await firstUpdate;
  assert.deepEqual(await first.load(), { locale: "en-US", sidebarOpen: false });
  assert.deepEqual(await second.load(), { locale: "zh-CN", sidebarOpen: true });
});
