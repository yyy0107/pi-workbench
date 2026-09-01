import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import test from "node:test";

import { defineDesktopSidecarRuntimeAuthPolicy } from "../src/runtime-transport-auth";

const {
  createUpgradeDispatcher,
  createWorkbenchHttpServer,
  isApiHttpRequest,
  isUpgradeRequiredHttpRequest,
} = (await import(
  new URL("../src/workbench-http-server.ts", import.meta.url).href
)) as typeof import("../src/workbench-http-server");

const UPGRADE_REQUIRED_PATHS = ["/api/events.mux", "/api/events.host", "/api/terminal"] as const;
const UPGRADE_REQUIRED_PATH_SET = new Set<string>(UPGRADE_REQUIRED_PATHS);
const DESKTOP_RENDERER_ORIGIN = "https://renderer.workbench.test";

function desktopSidecarAuth() {
  return defineDesktopSidecarRuntimeAuthPolicy({
    instanceId: "runtime-one",
    accessToken: "desktop-secret",
    allowedOrigins: [DESKTOP_RENDERER_ORIGIN],
  });
}

function requestWithHeaders(
  port: number,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () =>
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
      );
    });
    request.on("error", reject);
    request.end();
  });
}

test("recognizes only ordinary GET and HEAD requests for the injected upgrade paths", () => {
  assert.equal(
    isUpgradeRequiredHttpRequest(
      { method: "GET", url: "/api/events.mux" },
      UPGRADE_REQUIRED_PATH_SET,
    ),
    true,
  );
  assert.equal(
    isUpgradeRequiredHttpRequest(
      { method: "HEAD", url: "/api/events.host?generation=2" },
      UPGRADE_REQUIRED_PATH_SET,
    ),
    true,
  );
  assert.equal(
    isUpgradeRequiredHttpRequest(
      { method: "GET", url: "/api/terminal?sessionId=one" },
      UPGRADE_REQUIRED_PATH_SET,
    ),
    true,
  );
  assert.equal(
    isUpgradeRequiredHttpRequest(
      { method: "POST", url: "/api/events.mux" },
      UPGRADE_REQUIRED_PATH_SET,
    ),
    false,
  );
  assert.equal(
    isUpgradeRequiredHttpRequest(
      { method: "GET", url: "/api/events.mux/extra" },
      UPGRADE_REQUIRED_PATH_SET,
    ),
    false,
  );
  assert.equal(
    isUpgradeRequiredHttpRequest(
      { method: "GET", url: "/api/events.mux" },
      new Set(["/custom-upgrade"]),
    ),
    false,
  );
  assert.equal(
    isUpgradeRequiredHttpRequest(
      { method: "GET", url: "/custom-upgrade" },
      new Set(["/custom-upgrade"]),
    ),
    true,
  );
  assert.equal(isApiHttpRequest({ url: "/api/host.describe" }), true);
  assert.equal(isApiHttpRequest({ url: "/apiary" }), false);
});

test("classifies every Next-normalizable API request target before the Host security fence", () => {
  for (const url of [
    "/%61pi/pi/sessions",
    "/%2561pi/pi/sessions",
    "/api%2Fpi%2Fsessions",
    "/x/../api/pi/sessions",
    "/%2e%2e/api/pi/sessions",
    "/%252e%252e/api/pi/sessions",
    "/%5capi%5cpi%5csessions",
    String.raw`\api\pi\sessions`,
    String.raw`/x\..\api\pi\sessions`,
    "//api/pi/sessions",
    "/api//pi/sessions",
    "/api/pi/sessions/",
    "/%00api/pi/sessions",
    "/%zzapi/pi/sessions",
    "/%E0%A4%Aapi/pi/sessions",
  ]) {
    assert.equal(isApiHttpRequest({ url }), true, url);
  }

  for (const url of ["/apiary", "/%61piary", "/x/api/pi/sessions", "/health", "/x//health/"]) {
    assert.equal(isApiHttpRequest({ url }), false, url);
  }
});

test("encoded API targets cannot reach an injected handler before sidecar authentication", async (t) => {
  const delegated: string[] = [];
  const server = createWorkbenchHttpServer({
    requestHandler(request, response) {
      delegated.push(request.url ?? "");
      response.statusCode = 204;
      response.end();
    },
    webSocketGateway: { handleUpgrade: () => false },
    nonRuntimeUpgradeRelay: { emit: () => true },
    upgradeRequiredPaths: UPGRADE_REQUIRED_PATHS,
    desktopSidecarAuth: desktopSidecarAuth(),
  });
  t.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const response = await requestWithHeaders(port, "/%61pi/pi/sessions", {
    host: `127.0.0.1:${port}`,
    origin: DESKTOP_RENDERER_ORIGIN,
  });
  assert.equal(response.status, 401);
  assert.deepEqual(delegated, []);
});

test("returns 426 for ordinary stream requests and delegates other HTTP traffic", async (t) => {
  const delegated: string[] = [];
  const server = createWorkbenchHttpServer({
    requestHandler(request, response) {
      delegated.push(request.url ?? "");
      response.statusCode = 204;
      response.end();
    },
    webSocketGateway: { handleUpgrade: () => false },
    nonRuntimeUpgradeRelay: { emit: () => true },
    upgradeRequiredPaths: UPGRADE_REQUIRED_PATHS,
  });
  t.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const getResponse = await fetch(`http://127.0.0.1:${port}/api/events.mux?generation=3`);
  assert.equal(getResponse.status, 426);
  assert.equal(getResponse.headers.get("connection"), "Upgrade");
  assert.equal(getResponse.headers.get("upgrade"), "websocket");
  assert.equal(await getResponse.text(), "Upgrade Required");

  const headResponse = await fetch(`http://127.0.0.1:${port}/api/events.host`, {
    method: "HEAD",
  });
  assert.equal(headResponse.status, 426);
  assert.equal(headResponse.headers.get("connection"), "Upgrade");
  assert.equal(headResponse.headers.get("upgrade"), "websocket");
  assert.equal(await headResponse.text(), "");

  const terminalResponse = await fetch(
    `http://127.0.0.1:${port}/api/terminal?sessionId=workspace-1`,
  );
  assert.equal(terminalResponse.status, 426);
  assert.equal(await terminalResponse.text(), "Upgrade Required");

  const normalResponse = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(normalResponse.status, 204);
  assert.deepEqual(delegated, ["/health"]);
});

test("applies the API trust fence before returning 426 for stream paths", async (t) => {
  const server = createWorkbenchHttpServer({
    requestHandler(_request, response) {
      response.statusCode = 204;
      response.end();
    },
    webSocketGateway: { handleUpgrade: () => false },
    nonRuntimeUpgradeRelay: { emit: () => true },
    upgradeRequiredPaths: UPGRADE_REQUIRED_PATHS,
  });
  t.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const rebound = await requestWithHeaders(port, "/api/events.mux", {
    host: "attacker.example",
  });
  assert.equal(rebound.status, 403);
  assert.equal(rebound.body, "Forbidden");

  const crossSite = await requestWithHeaders(port, "/api/events.host", {
    host: `127.0.0.1:${port}`,
    "sec-fetch-site": "cross-site",
  });
  assert.equal(crossSite.status, 403);

  const ordinaryApi = await requestWithHeaders(port, "/api/host.describe", {
    host: "attacker.example",
  });
  assert.equal(ordinaryApi.status, 403);
});

test("handles sidecar preflight and scrubs Bearer credentials before delegating to the handler", async (t) => {
  const delegated: Array<{ headers: IncomingMessage["headers"]; rawHeaders: readonly string[] }> =
    [];
  const server = createWorkbenchHttpServer({
    requestHandler(request, response) {
      delegated.push({ headers: { ...request.headers }, rawHeaders: [...request.rawHeaders] });
      response.statusCode = 204;
      response.end();
    },
    webSocketGateway: { handleUpgrade: () => false },
    nonRuntimeUpgradeRelay: { emit: () => true },
    upgradeRequiredPaths: UPGRADE_REQUIRED_PATHS,
    desktopSidecarAuth: desktopSidecarAuth(),
  });
  t.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${port}/api/host.describe`;

  const preflight = await fetch(endpoint, {
    method: "OPTIONS",
    headers: {
      Origin: DESKTOP_RENDERER_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), DESKTOP_RENDERER_ORIGIN);
  assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
  assert.equal(preflight.headers.get("content-length"), "0");
  assert.deepEqual(
    new Set(
      (preflight.headers.get("vary") ?? "").split(",").map((value) => value.trim().toLowerCase()),
    ),
    new Set(["origin", "access-control-request-method", "access-control-request-headers"]),
  );
  assert.equal(delegated.length, 0, "preflight must not reach the injected handler");

  const unauthorized = await fetch(endpoint, {
    method: "POST",
    headers: { Origin: DESKTOP_RENDERER_ORIGIN },
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("www-authenticate"), "Bearer");
  assert.equal(unauthorized.headers.get("access-control-allow-origin"), DESKTOP_RENDERER_ORIGIN);
  assert.equal((await unauthorized.text()).includes("desktop-secret"), false);
  assert.equal(delegated.length, 0);

  const authorized = await fetch(endpoint, {
    method: "POST",
    headers: {
      Origin: DESKTOP_RENDERER_ORIGIN,
      Authorization: "Bearer desktop-secret",
      "Sec-Fetch-Site": "cross-site",
    },
  });
  assert.equal(authorized.status, 204);
  assert.equal(authorized.headers.get("access-control-allow-origin"), DESKTOP_RENDERER_ORIGIN);
  assert.equal(delegated.length, 1);
  assert.equal(delegated[0]?.headers.authorization, undefined);
  assert.equal(delegated[0]?.headers.origin, `http://127.0.0.1:${port}`);
  assert.equal(delegated[0]?.headers["sec-fetch-site"], "same-origin");
  assert.equal(JSON.stringify(delegated[0]?.rawHeaders).includes("desktop-secret"), false);

  const rebound = await requestWithHeaders(port, "/api/host.describe", {
    host: "attacker.example",
    origin: DESKTOP_RENDERER_ORIGIN,
    authorization: "Bearer desktop-secret",
  });
  assert.equal(rebound.status, 403);
});

test("rejects untrusted Runtime upgrades without intercepting a non-Runtime upgrade", () => {
  const gatewayOrigins: Array<string | string[] | undefined> = [];
  const relayUrls: string[] = [];
  const gateway = {
    handleUpgrade(request: IncomingMessage) {
      gatewayOrigins.push(request.headers.origin);
      return request.url === "/api/events.mux";
    },
  };
  const relay = {
    emit(_event: "upgrade", request: IncomingMessage): boolean {
      relayUrls.push(request.url ?? "");
      return true;
    },
  };
  const dispatch = createUpgradeDispatcher({
    webSocketGateway: gateway,
    nonRuntimeUpgradeRelay: relay,
    upgradeRequiredPaths: UPGRADE_REQUIRED_PATHS,
    desktopSidecarAuth: desktopSidecarAuth(),
  });
  const writes: string[] = [];
  let destroyed = 0;
  const socket = {
    write: (value: string) => writes.push(value),
    destroy: () => {
      destroyed += 1;
    },
  } as unknown as Duplex;
  const request = (url: string, origin?: string) =>
    ({
      url,
      headers: {
        host: "127.0.0.1:43127",
        ...(origin ? { origin, "sec-fetch-site": "cross-site" } : {}),
      },
      rawHeaders: [
        "Host",
        "127.0.0.1:43127",
        ...(origin ? ["Origin", origin, "Sec-Fetch-Site", "cross-site"] : []),
      ],
    }) as IncomingMessage;

  dispatch(request("/api/events.mux", "https://attacker.test"), socket, Buffer.alloc(0));
  assert.equal(writes[0]?.startsWith("HTTP/1.1 403"), true);
  assert.equal(destroyed, 1);
  assert.equal(gatewayOrigins.length, 0);

  dispatch(request("/api/events.mux", DESKTOP_RENDERER_ORIGIN), socket, Buffer.alloc(0));
  assert.deepEqual(gatewayOrigins, ["http://127.0.0.1:43127"]);

  dispatch(request("/%61pi/pi/sessions", "https://attacker.test"), socket, Buffer.alloc(0));
  assert.equal(writes[1]?.startsWith("HTTP/1.1 403"), true);
  assert.equal(destroyed, 2);
  assert.deepEqual(gatewayOrigins, ["http://127.0.0.1:43127"]);

  dispatch(request("/api/pi/sessions", DESKTOP_RENDERER_ORIGIN), socket, Buffer.alloc(0));
  assert.equal(destroyed, 3);
  assert.deepEqual(gatewayOrigins, ["http://127.0.0.1:43127"]);

  dispatch(request("/_next/hmr"), socket, Buffer.alloc(0));
  assert.deepEqual(gatewayOrigins, ["http://127.0.0.1:43127"]);
  assert.deepEqual(relayUrls, ["/_next/hmr"]);

  dispatch(request("/apiary"), socket, Buffer.alloc(0));
  assert.deepEqual(relayUrls, ["/_next/hmr", "/apiary"]);
});

test("never probes the business gateway for a Runtime path omitted from the allowlist", () => {
  let gatewayCalls = 0;
  let destroyed = 0;
  const writes: string[] = [];
  const dispatch = createUpgradeDispatcher({
    webSocketGateway: {
      handleUpgrade: () => {
        gatewayCalls += 1;
        return true;
      },
    },
    upgradeRequiredPaths: [],
    desktopSidecarAuth: desktopSidecarAuth(),
  });

  dispatch(
    {
      url: "/api/events.mux",
      headers: {
        host: "127.0.0.1:43127",
        origin: "https://attacker.test",
        "sec-fetch-site": "cross-site",
      },
      rawHeaders: [
        "Host",
        "127.0.0.1:43127",
        "Origin",
        "https://attacker.test",
        "Sec-Fetch-Site",
        "cross-site",
      ],
    } as IncomingMessage,
    {
      write: (value: string) => writes.push(value),
      destroy: () => (destroyed += 1),
    } as unknown as Duplex,
    Buffer.alloc(0),
  );

  assert.equal(gatewayCalls, 0);
  assert.equal(destroyed, 1);
  assert.equal(writes[0]?.startsWith("HTTP/1.1 403"), true);
});

test("never relays a Runtime-owned upgrade when its business gateway declines it", () => {
  let relayed = 0;
  let destroyed = 0;
  const dispatch = createUpgradeDispatcher({
    webSocketGateway: { handleUpgrade: () => false },
    nonRuntimeUpgradeRelay: {
      emit: () => {
        relayed += 1;
        return true;
      },
    },
    upgradeRequiredPaths: UPGRADE_REQUIRED_PATHS,
  });
  dispatch(
    {
      url: "/api/events.host",
      headers: { host: "127.0.0.1:43127", origin: "http://127.0.0.1:43127" },
    } as IncomingMessage,
    { destroy: () => (destroyed += 1) } as unknown as Duplex,
    Buffer.alloc(0),
  );
  assert.equal(relayed, 0);
  assert.equal(destroyed, 1);
});

test("uses one public dispatcher for gateway paths and relays all other upgrades", () => {
  const gatewayUrls: string[] = [];
  const relayUrls: string[] = [];
  const destroyed: string[] = [];
  const gateway = {
    handleUpgrade(request: IncomingMessage) {
      gatewayUrls.push(request.url ?? "");
      return UPGRADE_REQUIRED_PATH_SET.has(
        new URL(request.url ?? "/", "http://localhost").pathname,
      );
    },
  };
  const relay = {
    emit(event: "upgrade", request: IncomingMessage, _socket: Duplex, _head: Buffer): boolean {
      assert.equal(event, "upgrade");
      relayUrls.push(request.url ?? "");
      return true;
    },
  };
  const dispatch = createUpgradeDispatcher({
    webSocketGateway: gateway,
    nonRuntimeUpgradeRelay: relay,
    upgradeRequiredPaths: UPGRADE_REQUIRED_PATHS,
  });
  const socket = { destroy: () => destroyed.push("destroyed") } as unknown as Duplex;
  const head = Buffer.alloc(0);

  const trustedHeaders = { host: "127.0.0.1:43127", origin: "http://127.0.0.1:43127" };
  dispatch({ url: "/api/events.mux", headers: trustedHeaders } as IncomingMessage, socket, head);
  dispatch({ url: "/api/events.host", headers: trustedHeaders } as IncomingMessage, socket, head);
  dispatch(
    { url: "/api/terminal?sessionId=workspace-1", headers: trustedHeaders } as IncomingMessage,
    socket,
    head,
  );
  dispatch({ url: "/_next/webpack-hmr" } as IncomingMessage, socket, head);

  assert.deepEqual(gatewayUrls, [
    "/api/events.mux",
    "/api/events.host",
    "/api/terminal?sessionId=workspace-1",
  ]);
  assert.deepEqual(relayUrls, ["/_next/webpack-hmr"]);
  assert.deepEqual(destroyed, []);

  const server = createWorkbenchHttpServer({
    requestHandler: () => undefined,
    webSocketGateway: gateway,
    nonRuntimeUpgradeRelay: relay,
    upgradeRequiredPaths: UPGRADE_REQUIRED_PATHS,
  });
  assert.equal(server.listenerCount("upgrade"), 1);
  server.close();
});

test("honors an injected non-API Runtime upgrade path without exposing other traffic", () => {
  const gatewayUrls: string[] = [];
  const relayUrls: string[] = [];
  const dispatch = createUpgradeDispatcher({
    webSocketGateway: {
      handleUpgrade(request) {
        gatewayUrls.push(request.url ?? "");
        return true;
      },
    },
    nonRuntimeUpgradeRelay: {
      emit(_event, request) {
        relayUrls.push(request.url ?? "");
        return true;
      },
    },
    upgradeRequiredPaths: ["/custom-upgrade"],
  });
  const socket = { destroy: () => undefined } as unknown as Duplex;

  dispatch(
    {
      url: "/custom-upgrade",
      headers: { host: "127.0.0.1:43127", origin: "http://127.0.0.1:43127" },
    } as IncomingMessage,
    socket,
    Buffer.alloc(0),
  );
  dispatch({ url: "/ordinary-web-socket" } as IncomingMessage, socket, Buffer.alloc(0));

  assert.deepEqual(gatewayUrls, ["/custom-upgrade"]);
  assert.deepEqual(relayUrls, ["/ordinary-web-socket"]);
});

test("closes an unhandled upgrade when no non-Runtime relay is configured", () => {
  let missingUrl: string | undefined;
  let destroyed = false;
  const dispatch = createUpgradeDispatcher({
    webSocketGateway: { handleUpgrade: () => false },
    onUpgradeRelayMissing: (request) => {
      missingUrl = request.url;
    },
  });

  dispatch(
    { url: "/unknown" } as IncomingMessage,
    { destroy: () => (destroyed = true) } as unknown as Duplex,
    Buffer.alloc(0),
  );
  assert.equal(missingUrl, "/unknown");
  assert.equal(destroyed, true);
});
