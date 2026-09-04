import assert from "node:assert/strict";
import test from "node:test";

import type { PiWebSocket, PiWebSocketMessageEvent } from "../../src/transport/connections";
import { PiSessionManager } from "../../src/runtime/manager";
import { createPiHttpTransport } from "../../src/transport/api";

class InertSocket implements PiWebSocket {
  readonly readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: PiWebSocketMessageEvent) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  readonly path: string;
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];

  constructor(path: string) {
    this.path = path;
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
  }
}

function rpcValue(method: string, label: string): unknown {
  switch (method) {
    case "host.describe":
      return {
        product: "pi-workbench",
        version: label,
        piVersion: "0.84.2",
        cwd: `/workspace/${label}`,
        userPackageDir: `/packages/${label}`,
        attachedSessions: 0,
        canOpenPath: false,
      };
    case "session.list":
      return { items: [], runningSessionIds: [] };
    case "workspace.list":
      return { items: [], pinnedWorkspaceIds: [], pinnedSessionIds: [] };
    case "workspace.listArchivedSessions":
      return { sessionIds: [] };
    case "session.selectModel":
      return { selected: { provider: label, model: "isolated-model" } };
    default:
      throw new Error(`Unexpected RPC method: ${method}`);
  }
}

function managerTransportFixture(label: string) {
  const httpMethods: string[] = [];
  const sockets: InertSocket[] = [];
  return {
    httpMethods,
    sockets,
    transport: {
      http: async (_path: string, init?: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
        httpMethods.push(body.method);
        return Response.json({
          type: "server-response",
          rpcId: body.rpcId,
          result: { ok: true, value: rpcValue(body.method, label) },
        });
      },
      webSocketFactory: (path: string): PiWebSocket => {
        const socket = new InertSocket(`${label}:${path}`);
        sockets.push(socket);
        return socket;
      },
    },
  };
}

test("two installation-scoped managers keep HTTP and WebSocket transports strictly isolated", async (t) => {
  const first = managerTransportFixture("first");
  const second = managerTransportFixture("second");
  const firstManager = new PiSessionManager({ transport: first.transport });
  const secondManager = new PiSessionManager({ transport: second.transport });
  t.after(() => {
    firstManager.dispose();
    secondManager.dispose();
  });

  const firstController = firstManager.connections;
  const secondController = secondManager.connections;
  await Promise.all([firstManager.start(), secondManager.start()]);
  await Promise.all([firstManager.start(), secondManager.start()]);
  await firstManager.selectSessionModel({
    sessionId: "shared-session-id",
    provider: "first",
    model: "isolated-model",
  });
  assert.equal(
    firstManager.modelCatalogInvalidation.getSessionSelectionRevision("shared-session-id"),
    1,
  );
  assert.equal(
    secondManager.modelCatalogInvalidation.getSessionSelectionRevision("shared-session-id"),
    0,
  );
  await secondManager.selectSessionModel({
    sessionId: "shared-session-id",
    provider: "second",
    model: "isolated-model",
  });

  assert.notEqual(firstController, secondController);
  assert.equal(firstManager.connections, firstController, "one controller is retained per manager");
  assert.equal(
    secondManager.connections,
    secondController,
    "one controller is retained per manager",
  );
  assert.deepEqual(
    first.sockets.map((socket) => socket.path),
    ["first:/api/events.mux", "first:/api/events.host"],
  );
  assert.deepEqual(
    second.sockets.map((socket) => socket.path),
    ["second:/api/events.mux", "second:/api/events.host"],
  );
  assert.deepEqual(first.httpMethods.sort(), [
    "host.describe",
    "session.list",
    "session.selectModel",
    "workspace.list",
    "workspace.listArchivedSessions",
  ]);
  assert.deepEqual(second.httpMethods.sort(), [
    "host.describe",
    "session.list",
    "session.selectModel",
    "workspace.list",
    "workspace.listArchivedSessions",
  ]);
  assert.equal(firstManager.getHostDescription()?.version, "first");
  assert.equal(secondManager.getHostDescription()?.version, "second");
});

test("the manager preserves the existing default transport behavior", () => {
  const manager = new PiSessionManager();
  try {
    assert.equal(manager.rpcTransportOptions.transport, undefined);
    assert.ok(manager.rpcTransportOptions.invalidation);
    assert.equal(Object.isFrozen(manager.rpcTransportOptions), true);
    assert.equal(manager.connections, manager.connections);
  } finally {
    manager.dispose();
  }
});

test("same-instance-id sidecars keep package update results and invalidation isolated", async (t) => {
  const requests = { first: 0, second: 0 };
  const sidecarTransport = (label: "first" | "second", port: number, accessToken: string) =>
    createPiHttpTransport(
      {
        kind: "desktop-sidecar",
        protocolVersion: 1,
        httpOrigin: `http://127.0.0.1:${port}`,
        instanceId: "shared-instance-id",
        accessToken,
      },
      async (input, init) => {
        requests[label] += 1;
        assert.equal(input.origin, `http://127.0.0.1:${port}`);
        assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${accessToken}`);
        const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
        assert.equal(request.method, "package.updates");
        return Response.json({
          type: "server-response",
          rpcId: request.rpcId,
          result: {
            ok: true,
            value: {
              updates: [
                {
                  source: `npm:pi-${label}`,
                  displayName: `pi-${label}`,
                  type: "npm",
                  scope: "user",
                  filtered: false,
                  currentVersion: "1.0.0",
                  targetVersion: "1.1.0",
                },
              ],
            },
          },
        });
      },
    );
  const firstManager = new PiSessionManager({
    transport: { http: sidecarTransport("first", 41_001, "first-secret") },
  });
  const secondManager = new PiSessionManager({
    transport: { http: sidecarTransport("second", 41_002, "second-secret") },
  });
  t.after(() => {
    firstManager.dispose();
    secondManager.dispose();
  });

  const target = { scope: "user" as const };
  await Promise.all([
    firstManager.packageUpdatesQuery.ensure(target),
    secondManager.packageUpdatesQuery.ensure(target),
  ]);

  assert.equal(
    firstManager.packageUpdatesQuery.getSnapshot(target).value.updates[0]?.displayName,
    "pi-first",
  );
  assert.equal(
    secondManager.packageUpdatesQuery.getSnapshot(target).value.updates[0]?.displayName,
    "pi-second",
  );
  assert.deepEqual(requests, { first: 1, second: 1 });

  let firstNotifications = 0;
  let secondNotifications = 0;
  const unsubscribeFirst = firstManager.packageUpdatesQuery.subscribe(target, () => {
    firstNotifications += 1;
  });
  const unsubscribeSecond = secondManager.packageUpdatesQuery.subscribe(target, () => {
    secondNotifications += 1;
  });
  t.after(unsubscribeFirst);
  t.after(unsubscribeSecond);

  firstManager.packageUpdatesQuery.invalidate(target);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(requests, { first: 2, second: 1 });
  assert.equal(firstNotifications, 2);
  assert.equal(secondNotifications, 0);
  assert.equal(
    secondManager.packageUpdatesQuery.getSnapshot(target).value.updates[0]?.displayName,
    "pi-second",
  );
});

test("same-instance-id sidecars keep settings snapshots and mutation queues isolated", async (t) => {
  let releaseFirstUpdate: (() => void) | undefined;
  const requests = {
    first: [] as string[],
    second: [] as string[],
  };
  const sidecarTransport = (label: "first" | "second", port: number, accessToken: string) =>
    createPiHttpTransport(
      {
        kind: "desktop-sidecar",
        protocolVersion: 1,
        httpOrigin: `http://127.0.0.1:${port}`,
        instanceId: "shared-instance-id",
        accessToken,
      },
      async (input, init) => {
        assert.equal(input.origin, `http://127.0.0.1:${port}`);
        assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${accessToken}`);
        const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
        requests[label].push(request.method);
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
      },
    );
  const firstManager = new PiSessionManager({
    transport: { http: sidecarTransport("first", 42_001, "first-secret") },
  });
  const secondManager = new PiSessionManager({
    transport: { http: sidecarTransport("second", 42_002, "second-secret") },
  });
  t.after(() => {
    firstManager.dispose();
    secondManager.dispose();
  });

  assert.deepEqual(await firstManager.workbenchSettings.load(), { locale: "en-US" });
  assert.deepEqual(await firstManager.workbenchSettings.load(), { locale: "en-US" });
  assert.deepEqual(await secondManager.workbenchSettings.load(), { locale: "zh-CN" });
  assert.deepEqual(requests, {
    first: ["workbenchSettings.describe"],
    second: ["workbenchSettings.describe"],
  });

  const firstUpdate = firstManager.workbenchSettings.update({ sidebarOpen: false });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const secondUpdate = secondManager.workbenchSettings.update({ sidebarOpen: true });
  await secondUpdate;
  assert.deepEqual(requests.second, ["workbenchSettings.describe", "workbenchSettings.update"]);
  assert.ok(releaseFirstUpdate);
  releaseFirstUpdate();
  await firstUpdate;

  assert.deepEqual(await firstManager.workbenchSettings.load(), {
    locale: "en-US",
    sidebarOpen: false,
  });
  assert.deepEqual(await secondManager.workbenchSettings.load(), {
    locale: "zh-CN",
    sidebarOpen: true,
  });
});

test("same-session-id sidecars keep context policy snapshots and request revisions isolated", async (t) => {
  let releaseFirstLoad: (() => void) | undefined;
  const requests = { first: 0, second: 0 };
  const contextValue = (mode: "auto" | "maximum" | "custom") => ({
    policy: {
      mode,
      ...(mode === "custom" ? { desiredContextTokens: 32_000 } : {}),
    },
    overridden: mode === "custom",
    compaction: { enabled: true, reserveTokens: 4_096, keepRecentTokens: 8_192 },
    usage: { tokens: null, percent: null },
    nearingCompaction: false,
  });
  const sidecarTransport = (label: "first" | "second", port: number, accessToken: string) =>
    createPiHttpTransport(
      {
        kind: "desktop-sidecar",
        protocolVersion: 1,
        httpOrigin: `http://127.0.0.1:${port}`,
        instanceId: "shared-instance-id",
        accessToken,
      },
      async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as {
          rpcId: string;
          method: string;
          payload: { policy?: { mode?: "custom" } };
        };
        requests[label] += 1;
        if (label === "first" && request.method === "session.contextPolicy") {
          await new Promise<void>((resolve) => {
            releaseFirstLoad = resolve;
          });
        }
        return Response.json({
          type: "server-response",
          rpcId: request.rpcId,
          result: {
            ok: true,
            value: contextValue(
              request.payload.policy?.mode ?? (label === "first" ? "auto" : "maximum"),
            ),
          },
        });
      },
    );
  const firstManager = new PiSessionManager({
    transport: { http: sidecarTransport("first", 43_001, "first-secret") },
  });
  const secondManager = new PiSessionManager({
    transport: { http: sidecarTransport("second", 43_002, "second-secret") },
  });
  t.after(() => {
    firstManager.dispose();
    secondManager.dispose();
  });

  const firstLoad = firstManager.contextPolicies.load("shared-session-id");
  const secondLoad = secondManager.contextPolicies.load("shared-session-id");
  await secondLoad;
  assert.ok(releaseFirstLoad);
  releaseFirstLoad();
  await firstLoad;

  assert.equal(
    firstManager.contextPolicies.getSnapshot("shared-session-id").value?.policy.mode,
    "auto",
  );
  assert.equal(
    secondManager.contextPolicies.getSnapshot("shared-session-id").value?.policy.mode,
    "maximum",
  );
  assert.deepEqual(requests, { first: 1, second: 1 });

  await firstManager.contextPolicies.update("shared-session-id", {
    mode: "custom",
    desiredContextTokens: 32_000,
  });
  assert.equal(
    firstManager.contextPolicies.getSnapshot("shared-session-id").value?.policy.mode,
    "custom",
  );
  assert.equal(
    secondManager.contextPolicies.getSnapshot("shared-session-id").value?.policy.mode,
    "maximum",
  );
  assert.deepEqual(requests, { first: 2, second: 1 });
});
