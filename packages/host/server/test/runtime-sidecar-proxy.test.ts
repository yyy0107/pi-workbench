import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";

import { createRuntimeSidecarProxy } from "../src/runtime-sidecar-proxy";
import {
  createAuthenticatedNoServerWebSocketServer,
  defineDesktopSidecarRuntimeAuthPolicy,
} from "../src/runtime-transport-auth";
import { createUpgradeDispatcher, createWorkbenchHttpServer } from "../src/workbench-http-server";

const TOKEN = "private-sidecar-token";
const PUBLIC_ORIGIN = "https://public.workbench.test";

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function requestText(options: {
  readonly port: number;
  readonly path: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}): Promise<{
  readonly status: number;
  readonly headers: IncomingMessage["headers"];
  readonly body: string;
}> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port: options.port,
        path: options.path,
        method: options.method,
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.once("error", reject);
    request.end(options.body);
  });
}

function upgradeStatus(
  port: number,
  path: string,
  headers: Record<string, string>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      path,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": Buffer.alloc(16, 7).toString("base64"),
        ...headers,
      },
    });
    request.once("upgrade", (response, socket) => {
      socket.destroy();
      resolve(response.statusCode ?? 0);
    });
    request.once("response", (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode ?? 0));
    });
    request.once("error", reject);
    request.end();
  });
}

function withTimeout<T>(operation: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), 2_000);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

test("sidecar HTTP proxy scrubs browser authority, preserves streaming response semantics, and hides its token", async (t) => {
  let observedHeaders: IncomingMessage["headers"] | undefined;
  const inner = createServer((request, response) => {
    observedHeaders = request.headers;
    response.statusCode = 206;
    response.setHeader("Content-Range", "bytes 0-8/9");
    response.setHeader("Set-Cookie", ["first=one", "second=two"]);
    response.setHeader("Content-Type", "text/event-stream");
    response.write("data: one\n\n");
    setImmediate(() => response.end("data: two\n\n"));
  });
  const innerPort = await listen(inner);
  t.after(() => close(inner));
  const proxy = createRuntimeSidecarProxy({
    runtimeOrigin: `http://127.0.0.1:${innerPort}`,
    accessToken: TOKEN,
    publicOrigin: PUBLIC_ORIGIN,
  });
  const outer = createServer(proxy.handleHttp);
  outer.on("upgrade", proxy.handleUpgrade);
  const outerPort = await listen(outer);
  t.after(() => close(outer));

  const response = await requestText({
    port: outerPort,
    path: "/api/events?generation=3",
    headers: {
      Authorization: "Bearer browser-controlled-token",
      Origin: "https://attacker.example",
      "Sec-Fetch-Site": "cross-site",
      Host: "attacker.example",
      Range: "bytes=0-8",
    },
  });

  assert.equal(response.status, 206);
  assert.equal(response.headers["content-range"], "bytes 0-8/9");
  assert.deepEqual(response.headers["set-cookie"], ["first=one", "second=two"]);
  assert.equal(response.headers["content-type"], "text/event-stream");
  assert.equal(response.body, "data: one\n\ndata: two\n\n");
  assert.equal(observedHeaders?.authorization, `Bearer ${TOKEN}`);
  assert.equal(observedHeaders?.origin, PUBLIC_ORIGIN);
  assert.equal(observedHeaders?.["sec-fetch-site"], "same-origin");
  assert.equal(observedHeaders?.host, `127.0.0.1:${innerPort}`);
  assert.equal(observedHeaders?.range, "bytes=0-8");
  assert.equal(
    JSON.stringify({ response, observedHeaders }).includes("browser-controlled-token"),
    false,
  );
  assert.equal(JSON.stringify(response).includes(TOKEN), false);
});

test("sidecar HTTP proxy aborts its inner request when the public client disconnects", async (t) => {
  let resolveAborted!: () => void;
  let resolveStarted!: () => void;
  const aborted = new Promise<void>((resolve) => {
    resolveAborted = resolve;
  });
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const inner = createServer((request) => {
    resolveStarted();
    request.once("aborted", resolveAborted);
    request.once("close", () => {
      if (request.aborted) resolveAborted();
    });
  });
  const innerPort = await listen(inner);
  t.after(() => close(inner));
  const proxy = createRuntimeSidecarProxy({
    runtimeOrigin: `http://127.0.0.1:${innerPort}`,
    accessToken: TOKEN,
    publicOrigin: PUBLIC_ORIGIN,
  });
  const outer = createServer(proxy.handleHttp);
  const outerPort = await listen(outer);
  t.after(() => close(outer));

  const client = httpRequest({
    hostname: "127.0.0.1",
    port: outerPort,
    path: "/api/upload",
    method: "POST",
    headers: { "Content-Length": "100000" },
  });
  client.on("error", () => undefined);
  client.write("partial payload");
  await started;
  client.destroy();
  await Promise.race([
    aborted,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error("inner request was not aborted")), 1_000),
    ),
  ]);
});

test("sidecar raw WebSocket proxy injects credentials but preserves binary messages and close frames", async (t) => {
  let observedHeaders: IncomingMessage["headers"] | undefined;
  const inner = createServer();
  const innerWebSockets = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  inner.on("upgrade", (request, socket, head) => {
    observedHeaders = request.headers;
    innerWebSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSocket.once("message", (message, isBinary) => {
        assert.equal(isBinary, true);
        assert.deepEqual(message, Buffer.from([1, 2, 3]));
        webSocket.close(4100, "sidecar-close");
      });
    });
  });
  const innerPort = await listen(inner);
  t.after(async () => {
    await new Promise<void>((resolve) => innerWebSockets.close(() => resolve()));
    await close(inner);
  });
  const proxy = createRuntimeSidecarProxy({
    runtimeOrigin: `http://127.0.0.1:${innerPort}`,
    accessToken: TOKEN,
    publicOrigin: PUBLIC_ORIGIN,
  });
  const outer = createServer(proxy.handleHttp);
  outer.on("upgrade", proxy.handleUpgrade);
  const outerPort = await listen(outer);
  t.after(() => close(outer));

  const browser = new WebSocket(`ws://127.0.0.1:${outerPort}/api/events.mux`, {
    headers: {
      Authorization: "Bearer browser-controlled-token",
      Origin: "https://attacker.example",
      "Sec-Fetch-Site": "cross-site",
    },
  });
  try {
    await once(browser, "open");
    browser.send(Buffer.from([1, 2, 3]), { binary: true });
    const [code, reason] = (await once(browser, "close")) as [number, Buffer];
    assert.equal(code, 4100);
    assert.equal(reason.toString(), "sidecar-close");
    assert.equal(observedHeaders?.authorization, `Bearer ${TOKEN}`);
    assert.equal(observedHeaders?.origin, PUBLIC_ORIGIN);
    assert.equal(observedHeaders?.["sec-fetch-site"], "same-origin");
    assert.equal(JSON.stringify(observedHeaders).includes("browser-controlled-token"), false);
    assert.equal(
      JSON.stringify(observedHeaders).includes(TOKEN),
      true,
      "token stays only on inner hop",
    );
  } finally {
    browser.close();
  }
});

test("stopped sidecar proxy rejects new HTTP admissions", async (t) => {
  const inner = createServer((_request, response) => response.end("unexpected"));
  const innerPort = await listen(inner);
  t.after(() => close(inner));
  const proxy = createRuntimeSidecarProxy({
    runtimeOrigin: `http://127.0.0.1:${innerPort}`,
    accessToken: TOKEN,
    publicOrigin: PUBLIC_ORIGIN,
  });
  const outer = createServer(proxy.handleHttp);
  const outerPort = await listen(outer);
  t.after(() => close(outer));
  proxy.stopAdmission();

  const response = await requestText({ port: outerPort, path: "/api/health" });
  assert.equal(response.status, 503);
  assert.equal(response.body, "Runtime unavailable.");
  assert.equal(proxy.accepting, false);
});

test("public Upgrade trust is enforced before the sidecar can inject credentials", async (t) => {
  let childUpgrades = 0;
  let resolveRelayed!: () => void;
  const relayed = new Promise<void>((resolve) => {
    resolveRelayed = resolve;
  });
  const inner = createServer();
  const childWebSockets = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  inner.on("upgrade", (request, socket, head) => {
    childUpgrades += 1;
    childWebSockets.handleUpgrade(request, socket, head, (webSocket) => webSocket.close());
  });
  const innerPort = await listen(inner);
  t.after(async () => {
    await new Promise<void>((resolve) => childWebSockets.close(() => resolve()));
    await close(inner);
  });
  const proxy = createRuntimeSidecarProxy({
    runtimeOrigin: `http://127.0.0.1:${innerPort}`,
    accessToken: TOKEN,
    publicOrigin: "http://127.0.0.1:1",
  });
  const outer = createWorkbenchHttpServer({
    requestHandler: proxy.handleHttp,
    webSocketGateway: proxy,
    upgradeRequiredPaths: ["/api/events.mux"],
    nonRuntimeUpgradeRelay: {
      emit(_event, _request, socket) {
        resolveRelayed();
        socket.destroy();
        return true;
      },
    },
  });
  const outerPort = await listen(outer);
  t.after(() => close(outer));
  const publicOrigin = `http://127.0.0.1:${outerPort}`;

  await Promise.all([
    upgradeStatus(outerPort, "/api/events.mux", {
      Host: "attacker.example",
      Origin: "https://attacker.example",
    }).then((status) => assert.equal(status, 403)),
    upgradeStatus(outerPort, "/api/events.mux", {
      Host: `127.0.0.1:${outerPort}`,
      Origin: publicOrigin,
      "Sec-Fetch-Site": "cross-site",
    }).then((status) => assert.equal(status, 403)),
  ]);
  assert.equal(childUpgrades, 0);

  assert.equal(
    await upgradeStatus(outerPort, "/api/events.mux", {
      Host: `127.0.0.1:${outerPort}`,
      Origin: publicOrigin,
      "Sec-Fetch-Site": "same-origin",
    }),
    101,
  );
  assert.equal(childUpgrades, 1);

  assert.equal(
    await upgradeStatus(outerPort, "/%2561pi/events.mux", {
      Host: "attacker.example",
      Origin: "https://attacker.example",
    }),
    403,
  );
  assert.equal(childUpgrades, 1);

  void upgradeStatus(outerPort, "/_next/webpack-hmr", { Host: "attacker.example" }).catch(
    () => undefined,
  );
  await relayed;
  assert.equal(childUpgrades, 1);
});

test("public mux, host, and terminal upgrades consume cloned-policy child authorization without exposing auth framing", async (t) => {
  const paths = ["/api/events.mux", "/api/events.host", "/api/terminal"] as const;
  const publicServer = createServer();
  const rejectedAuthServer = createServer();
  const publicPort = await listen(publicServer);
  const rejectedAuthPort = await listen(rejectedAuthServer);
  const publicOrigin = `http://127.0.0.1:${publicPort}`;
  const rejectedAuthOrigin = `http://127.0.0.1:${rejectedAuthPort}`;
  const listenerPolicy = defineDesktopSidecarRuntimeAuthPolicy({
    instanceId: "proxy-composition",
    accessToken: TOKEN,
    allowedOrigins: [publicOrigin, rejectedAuthOrigin],
    webSocketAuthenticationTimeoutMs: 250,
  });
  const gatewayPolicy = defineDesktopSidecarRuntimeAuthPolicy({
    instanceId: listenerPolicy.instanceId,
    accessToken: listenerPolicy.accessToken,
    allowedOrigins: listenerPolicy.allowedOrigins,
    webSocketAuthenticationTimeoutMs: listenerPolicy.webSocketAuthenticationTimeoutMs,
  });
  assert.notEqual(listenerPolicy, gatewayPolicy, "listener and gateway policies must be clones");

  const rawWebSocketServer = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const authenticatedWebSocketServer = createAuthenticatedNoServerWebSocketServer({
    authPolicy: gatewayPolicy,
    webSocketServer: rawWebSocketServer,
  });
  const businessAllocations = new Map<string, number>();
  let childGatewayAdmissions = 0;
  const childServer = createWorkbenchHttpServer({
    desktopSidecarAuth: listenerPolicy,
    requestHandler(_request, response) {
      response.statusCode = 204;
      response.end();
    },
    upgradeRequiredPaths: paths,
    webSocketGateway: {
      handleUpgrade(request, socket, head) {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (!paths.includes(pathname as (typeof paths)[number])) return false;
        childGatewayAdmissions += 1;
        authenticatedWebSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
          businessAllocations.set(pathname, (businessAllocations.get(pathname) ?? 0) + 1);
          webSocket.send(`business:${pathname}`);
        });
        return true;
      },
    },
  });
  const childPort = await listen(childServer);
  const childOrigin = `http://127.0.0.1:${childPort}`;

  const publicProxy = createRuntimeSidecarProxy({
    runtimeOrigin: childOrigin,
    accessToken: TOKEN,
    publicOrigin,
  });
  const rejectedAuthProxy = createRuntimeSidecarProxy({
    runtimeOrigin: childOrigin,
    accessToken: "wrong-private-sidecar-token",
    publicOrigin: rejectedAuthOrigin,
  });
  publicServer.on("request", publicProxy.handleHttp);
  publicServer.on(
    "upgrade",
    createUpgradeDispatcher({
      webSocketGateway: publicProxy,
      upgradeRequiredPaths: paths,
    }),
  );
  rejectedAuthServer.on("request", rejectedAuthProxy.handleHttp);
  rejectedAuthServer.on(
    "upgrade",
    createUpgradeDispatcher({
      webSocketGateway: rejectedAuthProxy,
      upgradeRequiredPaths: paths,
    }),
  );

  t.after(async () => {
    publicProxy.stopAdmission();
    rejectedAuthProxy.stopAdmission();
    for (const webSocket of rawWebSocketServer.clients) webSocket.terminate();
    await new Promise<void>((resolve) => rawWebSocketServer.close(() => resolve()));
    await Promise.all([close(childServer), close(publicServer), close(rejectedAuthServer)]);
  });

  const directPending = new WebSocket(`${childOrigin.replace("http:", "ws:")}${paths[0]}`, {
    headers: { Origin: publicOrigin, "Sec-Fetch-Site": "same-origin" },
  });
  await withTimeout(
    once(directPending, "open").then(() => undefined),
    "direct child did not upgrade",
  );
  assert.equal(childGatewayAdmissions, 1);
  assert.equal(
    businessAllocations.size,
    0,
    "legacy first-frame auth must allocate no business state",
  );
  directPending.close();
  await withTimeout(
    once(directPending, "close").then(() => undefined),
    "direct child did not close",
  );

  const admissionsBeforeOuterRejections = childGatewayAdmissions;
  await Promise.all([
    upgradeStatus(publicPort, paths[0], {
      Host: "attacker.example",
      Origin: "https://attacker.example",
    }).then((status) => assert.equal(status, 403)),
    upgradeStatus(publicPort, paths[1], {
      Host: `127.0.0.1:${publicPort}`,
      Origin: "https://attacker.example",
    }).then((status) => assert.equal(status, 403)),
  ]);
  assert.equal(
    childGatewayAdmissions,
    admissionsBeforeOuterRejections,
    "outer trust failures must not reach the child",
  );

  const rejected = await requestText({
    port: rejectedAuthPort,
    path: paths[2],
    headers: {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": Buffer.alloc(16, 9).toString("base64"),
      Origin: rejectedAuthOrigin,
      "Sec-Fetch-Site": "same-origin",
    },
  });
  assert.equal(rejected.status, 403);
  assert.equal(JSON.stringify(rejected).includes(TOKEN), false);
  assert.equal(JSON.stringify(rejected).includes("wrong-private-sidecar-token"), false);
  assert.equal(childGatewayAdmissions, admissionsBeforeOuterRejections);

  for (const path of paths) {
    const browser = new WebSocket(`ws://127.0.0.1:${publicPort}${path}`, {
      headers: { Origin: publicOrigin, "Sec-Fetch-Site": "same-origin" },
    });
    const message = withTimeout(once(browser, "message"), `${path} did not emit a business frame`);
    await withTimeout(
      once(browser, "open").then(() => undefined),
      `${path} did not open`,
    );
    const [raw] = await message;
    const text = String(raw);
    assert.equal(text, `business:${path}`);
    assert.equal(text.includes("authenticated"), false);
    assert.equal(text.includes(TOKEN), false);
    browser.close();
    await withTimeout(
      once(browser, "close").then(() => undefined),
      `${path} did not close`,
    );
  }
  assert.deepEqual(
    Object.fromEntries(paths.map((path) => [path, businessAllocations.get(path)])),
    Object.fromEntries(paths.map((path) => [path, 1])),
  );
});
