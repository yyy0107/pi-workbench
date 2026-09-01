import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";

import {
  RUNTIME_CONNECTION_PROTOCOL_VERSION,
  createRuntimeWebSocketAuthenticateFrame,
  defineRuntimeConnection,
} from "@workbench/host-contracts";
import { createRuntimeFetch } from "@workbench/host-client";

import {
  API_ONLY_RUNTIME_HOST,
  RuntimeHostLifecycleReason,
  createRuntimeHostFetchHandler,
  startApiOnlyRuntimeHost,
  type ApiOnlyRuntimeHostStartOptions,
} from "../src/api-only-runtime-host";
import {
  createAuthenticatedNoServerWebSocketServer,
  defineDesktopSidecarRuntimeAuthPolicy,
} from "../src/runtime-transport-auth";

const RENDERER_ORIGIN = "https://renderer.workbench.test";
const ACCESS_TOKEN = "api-only-fixture-secret";

test("rejects provider-specific or path-bearing fields in the generic endpoint identity", () => {
  assert.throws(() =>
    createRuntimeHostFetchHandler({
      identity: {
        product: "workbench-runtime-host",
        hostProtocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
        instanceId: "fixture",
        pid: 123,
        userPackageDir: "/sensitive/user/path",
      } as never,
      runtimeApi: () => new Response(null, { status: 204 }),
    }),
  );
});

function fixtureOptions(
  overrides: Partial<ApiOnlyRuntimeHostStartOptions> = {},
): ApiOnlyRuntimeHostStartOptions {
  return {
    host: API_ONLY_RUNTIME_HOST,
    port: 0,
    pid: 4242,
    desktopSidecarAuth: defineDesktopSidecarRuntimeAuthPolicy({
      instanceId: "non-pi-fixture",
      accessToken: ACCESS_TOKEN,
      allowedOrigins: [RENDERER_ORIGIN],
    }),
    runtimeApi: () => Response.json({ fixture: "non-pi" }),
    webSocketGateway: { handleUpgrade: () => false },
    upgradeRequiredPaths: [],
    lifecycle: { dispose: () => undefined },
    ...overrides,
  };
}

test("starts a non-Pi API-only fixture on loopback port zero with authenticated health and identity", async (t) => {
  let delegatedAuthorization: string | null | undefined;
  let delegatedOrigin: string | null | undefined;
  let disposeCalls = 0;
  const running = await startApiOnlyRuntimeHost(
    fixtureOptions({
      runtimeApi(request) {
        delegatedAuthorization = request.headers.get("authorization");
        delegatedOrigin = request.headers.get("origin");
        return Response.json({ fixture: "non-pi" });
      },
      lifecycle: {
        dispose() {
          disposeCalls += 1;
        },
      },
    }),
  );
  t.after(() =>
    running.shutdown({ reason: RuntimeHostLifecycleReason.requested, deadlineMs: 5_000 }),
  );

  assert.equal(running.host, "127.0.0.1");
  assert.equal(running.port > 0, true);
  assert.equal(running.httpOrigin, `http://127.0.0.1:${running.port}`);
  assert.deepEqual(running.identity, {
    product: "workbench-runtime-host",
    hostProtocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    instanceId: "non-pi-fixture",
    pid: 4242,
  });

  const unauthorized = await fetch(`${running.httpOrigin}/api/health`);
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.text()).includes(ACCESS_TOKEN), false);

  const connection = defineRuntimeConnection({
    kind: "desktop-sidecar",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    httpOrigin: running.httpOrigin,
    instanceId: running.identity.instanceId,
    accessToken: ACCESS_TOKEN,
  });
  const runtimeFetch = createRuntimeFetch(connection);
  const health = await runtimeFetch("/api/health", {
    headers: { Origin: RENDERER_ORIGIN },
  });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    status: "ok",
    hostProtocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    instanceId: "non-pi-fixture",
  });

  const identity = await runtimeFetch("/api/identity", {
    headers: { Origin: RENDERER_ORIGIN },
  });
  assert.deepEqual(await identity.json(), running.identity);

  const head = await runtimeFetch("/api/identity", {
    method: "HEAD",
    headers: { Origin: RENDERER_ORIGIN },
  });
  assert.equal(Number(head.headers.get("content-length")) > 0, true);
  assert.equal(await head.text(), "");

  const methodNotAllowed = await runtimeFetch("/api/health", {
    method: "POST",
    headers: { Origin: RENDERER_ORIGIN },
  });
  assert.equal(methodNotAllowed.status, 405);
  assert.equal(methodNotAllowed.headers.get("allow"), "GET, HEAD");

  const fixture = await runtimeFetch("/api/fixture", {
    headers: { Origin: RENDERER_ORIGIN },
  });
  assert.deepEqual(await fixture.json(), { fixture: "non-pi" });
  assert.equal(delegatedAuthorization, null);
  assert.equal(delegatedOrigin, running.httpOrigin);

  const nonApi = await fetch(`${running.httpOrigin}/web-page`);
  assert.equal(nonApi.status, 404);
  assert.equal(disposeCalls, 0);

  await assert.rejects(
    running.shutdown({ reason: RuntimeHostLifecycleReason.requested, deadlineMs: 0 }),
    /Invalid Runtime Host shutdown request/u,
  );
  assert.equal(running.server.listening, true, "invalid shutdown must not poison Host state");

  await running.shutdown({ reason: RuntimeHostLifecycleReason.requested, deadlineMs: 5_000 });
  await running.shutdown({ reason: RuntimeHostLifecycleReason.restart, deadlineMs: 1_000 });
  assert.equal(disposeCalls, 1, "shutdown must preserve one lifecycle graph");
  assert.equal(running.server.listening, false);
});

test("preserves Host-owned CORS headers while merging an injected handler's Vary tokens", async () => {
  const running = await startApiOnlyRuntimeHost(
    fixtureOptions({
      runtimeApi: () =>
        new Response("safe body", {
          headers: {
            "Access-Control-Allow-Origin": "https://attacker.test",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Expose-Headers": "X-Secret",
            "Access-Control-Max-Age": "999999",
            "Access-Control-Allow-Private-Network": "true",
            Vary: "Accept-Encoding, origin, X-Attacker",
            "X-Runtime": "preserved",
          },
        }),
    }),
  );

  try {
    const response = await fetch(`${running.httpOrigin}/api/fixture`, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        Origin: RENDERER_ORIGIN,
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), RENDERER_ORIGIN);
    for (const name of [
      "access-control-allow-credentials",
      "access-control-allow-methods",
      "access-control-allow-headers",
      "access-control-expose-headers",
      "access-control-max-age",
      "access-control-allow-private-network",
    ]) {
      assert.equal(response.headers.get(name), null, `${name} remains Host-owned`);
    }
    assert.equal(response.headers.get("x-runtime"), "preserved");
    assert.deepEqual(
      response.headers
        .get("vary")!
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .sort(),
      ["accept-encoding", "origin", "x-attacker"],
    );
  } finally {
    await running.shutdown({ reason: RuntimeHostLifecycleReason.requested, deadlineMs: 5_000 });
  }
});

test("does not resolve shutdown until injected Runtime disposal completes", async () => {
  let releaseDispose!: () => void;
  const disposal = new Promise<void>((resolve) => (releaseDispose = resolve));
  let disposalStarted = false;
  const running = await startApiOnlyRuntimeHost(
    fixtureOptions({
      lifecycle: {
        dispose() {
          disposalStarted = true;
          return disposal;
        },
      },
    }),
  );
  let settled = false;
  const shutdown = running
    .shutdown({ reason: RuntimeHostLifecycleReason.requested, deadlineMs: 5_000 })
    .then(() => (settled = true));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(disposalStarted, true);
  assert.equal(settled, false);
  assert.equal(
    running.server.listening,
    false,
    "shutdown must stop accepting before disposal waits",
  );
  await assert.rejects(fetch(`${running.httpOrigin}/api/health`));
  releaseDispose();
  await shutdown;
  assert.equal(running.server.listening, false);
});

test("bounds total shutdown and aborts an uncooperative injected lifecycle", async () => {
  let disposalSignal: AbortSignal | undefined;
  const running = await startApiOnlyRuntimeHost(
    fixtureOptions({
      lifecycle: {
        dispose({ signal }) {
          disposalSignal = signal;
          return new Promise<void>(() => undefined);
        },
      },
    }),
  );

  const startedAt = Date.now();
  await assert.rejects(
    running.shutdown({ reason: RuntimeHostLifecycleReason.requested, deadlineMs: 20 }),
    (error: unknown) =>
      error instanceof Error && error.message === "Runtime Host shutdown deadline expired.",
  );
  assert.ok(disposalSignal);
  assert.equal(disposalSignal.aborted, true);
  assert.equal(
    disposalSignal.reason instanceof Error ? disposalSignal.reason.message : undefined,
    "Runtime Host shutdown deadline expired.",
  );
  assert.equal(Date.now() - startedAt < 1_000, true, "shutdown must be deadline-bounded");
  assert.equal(running.server.listening, false);
  await assert.rejects(fetch(`${running.httpOrigin}/api/health`));
});

test("requires the injected lifecycle to close active upgraded sockets before shutdown completes", async (t) => {
  const authPolicy = defineDesktopSidecarRuntimeAuthPolicy({
    instanceId: "upgrade-fixture",
    accessToken: ACCESS_TOKEN,
    allowedOrigins: [RENDERER_ORIGIN],
  });
  const rawWebSocketServer = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const authenticatedWebSocketServer = createAuthenticatedNoServerWebSocketServer({
    authPolicy,
    webSocketServer: rawWebSocketServer,
  });
  let businessConnections = 0;
  let disposeObservedActiveUpgrade = false;
  const running = await startApiOnlyRuntimeHost(
    fixtureOptions({
      desktopSidecarAuth: authPolicy,
      upgradeRequiredPaths: ["/api/fixture.ws"],
      webSocketGateway: {
        handleUpgrade(request, socket, head) {
          if (new URL(request.url ?? "/", "http://localhost").pathname !== "/api/fixture.ws") {
            return false;
          }
          authenticatedWebSocketServer.handleUpgrade(request, socket, head, () => {
            businessConnections += 1;
          });
          return true;
        },
      },
      lifecycle: {
        async dispose() {
          disposeObservedActiveUpgrade = rawWebSocketServer.clients.size === 1;
          for (const client of rawWebSocketServer.clients) client.terminate();
          await new Promise<void>((resolve) => rawWebSocketServer.close(() => resolve()));
        },
      },
    }),
  );
  t.after(async () => {
    for (const client of rawWebSocketServer.clients) client.terminate();
    await running
      .shutdown({ reason: RuntimeHostLifecycleReason.requested, deadlineMs: 5_000 })
      .catch(() => undefined);
  });

  const client = new WebSocket(`ws://127.0.0.1:${running.port}/api/fixture.ws`, {
    headers: { Origin: RENDERER_ORIGIN },
  });
  await once(client, "open");
  const authenticated = once(client, "message");
  client.send(
    JSON.stringify(
      createRuntimeWebSocketAuthenticateFrame({
        kind: "desktop-sidecar",
        protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
        httpOrigin: running.httpOrigin,
        instanceId: authPolicy.instanceId,
        accessToken: authPolicy.accessToken,
      }),
    ),
  );
  const [acknowledgement] = await authenticated;
  assert.equal(JSON.parse(String(acknowledgement)).type, "authenticated");
  assert.equal(businessConnections, 1);

  const closed = once(client, "close");
  await running.shutdown({ reason: RuntimeHostLifecycleReason.requested, deadlineMs: 5_000 });
  await closed;
  assert.equal(disposeObservedActiveUpgrade, true);
  assert.equal(rawWebSocketServer.clients.size, 0);
  assert.equal(running.server.listening, false);
});

test("disposes setup state after bind failure and after a failed bound identity probe", async () => {
  const occupied = createServer();
  occupied.listen(0, API_ONLY_RUNTIME_HOST);
  await once(occupied, "listening");
  const occupiedPort = (occupied.address() as AddressInfo).port;
  let bindFailureDisposals = 0;
  await assert.rejects(
    startApiOnlyRuntimeHost(
      fixtureOptions({
        port: occupiedPort,
        lifecycle: {
          dispose() {
            bindFailureDisposals += 1;
          },
        },
      }),
    ),
    /API-only Runtime Host startup failed/u,
  );
  assert.equal(bindFailureDisposals, 1);
  await new Promise<void>((resolve, reject) =>
    occupied.close((error) => (error ? reject(error) : resolve())),
  );

  let probedOrigin = "";
  let probeFailureDisposals = 0;
  await assert.rejects(
    startApiOnlyRuntimeHost(
      fixtureOptions({
        identityProbe: (async (input) => {
          probedOrigin = new URL(String(input)).origin;
          return Response.json({ wrong: "identity" });
        }) as typeof fetch,
        lifecycle: {
          dispose() {
            probeFailureDisposals += 1;
          },
        },
      }),
    ),
    /API-only Runtime Host startup failed/u,
  );
  assert.equal(probeFailureDisposals, 1);
  await assert.rejects(fetch(`${probedOrigin}/api/identity`));
});
