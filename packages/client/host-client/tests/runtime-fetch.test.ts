import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_CONNECTION_PROTOCOL_VERSION,
  defineRuntimeConnection,
  type DesktopSidecarRuntimeConnection,
  type RuntimeConnection,
} from "@workbench/host-contracts";
import {
  createRuntimeFetch,
  resolveRuntimeHttpUrl,
  resolveRuntimeWebSocketUrl,
  type RuntimeFetchImplementation,
} from "../src/runtime-fetch";

const sameOrigin = defineRuntimeConnection({
  kind: "same-origin",
  protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
  httpOrigin: "https://workbench.example.test",
});

function defineDesktopSidecar(): DesktopSidecarRuntimeConnection {
  const connection = defineRuntimeConnection({
    kind: "desktop-sidecar",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    httpOrigin: "http://127.0.0.1:43127",
    instanceId: "runtime-1",
    accessToken: "desktop-secret-token",
  });
  if (connection.kind !== "desktop-sidecar")
    throw new Error("Expected a desktop Runtime connection.");
  return connection;
}

const desktopSidecar = defineDesktopSidecar();

test("resolves only root-relative Runtime HTTP paths", () => {
  assert.equal(
    resolveRuntimeHttpUrl(sameOrigin, "/api/host.describe?source=renderer").href,
    "https://workbench.example.test/api/host.describe?source=renderer",
  );

  for (const path of [
    "api/host.describe",
    "https://untrusted.example.test/api",
    "//untrusted.example.test/api",
    "/\\untrusted.example.test/api",
  ]) {
    assert.throws(() => resolveRuntimeHttpUrl(sameOrigin, path), /root-relative path/);
  }
});

test("maps HTTP Runtime origins to the matching WebSocket scheme without credentials", () => {
  assert.equal(
    resolveRuntimeWebSocketUrl(sameOrigin, "/api/events.host").href,
    "wss://workbench.example.test/api/events.host",
  );
  assert.equal(
    resolveRuntimeWebSocketUrl(desktopSidecar, "/api/events.host").href,
    "ws://127.0.0.1:43127/api/events.host",
  );
  assert.equal(
    resolveRuntimeWebSocketUrl(desktopSidecar, "/api/events.host").href.includes("token"),
    false,
  );
});

test("accepts only a numeric 127.0.0.1 HTTP sidecar origin", () => {
  const invalidOrigins = [
    "https://127.0.0.1:43127",
    "http://localhost:43127",
    "http://127.0.0.1",
    "http://127.0.0.1:65536",
    "http://127.0.0.1:43127/runtime",
  ];

  for (const httpOrigin of invalidOrigins) {
    const connection = {
      ...desktopSidecar,
      httpOrigin,
    } as RuntimeConnection;
    assert.throws(
      () => resolveRuntimeHttpUrl(connection, "/api/health"),
      /Invalid Runtime connection/,
    );
  }
});

test("injects and overrides desktop HTTP bearer authentication without leaking the token to URLs", async () => {
  const calls: Array<{ input: URL; init?: RequestInit }> = [];
  const fetchImplementation: RuntimeFetchImplementation = async (input, init) => {
    calls.push({ input, init });
    return new Response(null, { status: 204 });
  };
  const runtimeFetch = createRuntimeFetch(desktopSidecar, fetchImplementation);

  await runtimeFetch("/api/host.describe", {
    headers: { Authorization: "Bearer caller-value", "X-Request-Id": "request-1" },
  });

  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.input.href, "http://127.0.0.1:43127/api/host.describe");
  assert.equal(call.input.href.includes(desktopSidecar.accessToken), false);
  assert.equal(new Headers(call.init?.headers).get("Authorization"), "Bearer desktop-secret-token");
  assert.equal(new Headers(call.init?.headers).get("X-Request-Id"), "request-1");
});

test("leaves same-origin HTTP headers untouched and never includes a desktop token in thrown errors", async () => {
  const calls: Array<{ input: URL; init?: RequestInit }> = [];
  const fetchImplementation: RuntimeFetchImplementation = async (input, init) => {
    calls.push({ input, init });
    return new Response(null, { status: 204 });
  };
  await createRuntimeFetch(sameOrigin, fetchImplementation)("/api/health");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init?.headers, undefined);

  assert.throws(
    () => resolveRuntimeHttpUrl(desktopSidecar, "https://untrusted.example.test/api"),
    (error) =>
      error instanceof Error &&
      !error.message.includes(desktopSidecar.accessToken) &&
      !String(error).includes(desktopSidecar.accessToken),
  );
});

test("default resolver preserves same-origin selection, explicit transport and non-browser fallback", async (t) => {
  const { resolveRuntimeFetch } = await import("../src/runtime-fetch");
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  t.after(() => {
    if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
    else Reflect.deleteProperty(globalThis, "location");
  });
  const calls: Array<string | URL | Request> = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    calls.push(input);
    return new Response(null, { status: 204 });
  });
  // Only the environment origin is supplied; no DOM or rendered component is involved.
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { origin: "https://workbench.example.test" },
  });
  await resolveRuntimeFetch()("/api/health");
  assert.equal(String(calls[0]), "https://workbench.example.test/api/health");
  await assert.rejects(
    resolveRuntimeFetch()("https://untrusted.example.test/api"),
    /root-relative path/,
  );
  assert.equal(calls.length, 1);
  const explicit = async () => new Response("explicit");
  assert.equal(resolveRuntimeFetch(explicit), explicit);
  Object.defineProperty(globalThis, "location", { configurable: true, value: undefined });
  await resolveRuntimeFetch()("/api/health");
  assert.equal(calls[1], "/api/health");
});
