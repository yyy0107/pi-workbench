import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import test from "node:test";

const {
  createUpgradeDispatcher,
  createWorkbenchHttpServer,
  isApiHttpRequest,
  isStreamHttpRequest,
} = (await import(
  new URL("./custom-server.ts", import.meta.url).href
)) as typeof import("./custom-server");

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

test("recognizes only ordinary GET and HEAD requests for the exact stream paths", () => {
  assert.equal(isStreamHttpRequest({ method: "GET", url: "/api/events.mux" }), true);
  assert.equal(isStreamHttpRequest({ method: "HEAD", url: "/api/events.host?generation=2" }), true);
  assert.equal(isStreamHttpRequest({ method: "GET", url: "/api/terminal?sessionId=one" }), true);
  assert.equal(isStreamHttpRequest({ method: "POST", url: "/api/events.mux" }), false);
  assert.equal(isStreamHttpRequest({ method: "GET", url: "/api/events.mux/extra" }), false);
  assert.equal(isApiHttpRequest({ url: "/api/host.describe" }), true);
  assert.equal(isApiHttpRequest({ url: "/apiary" }), false);
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
    nextUpgradeRelay: { emit: () => true },
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
    nextUpgradeRelay: { emit: () => true },
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

test("uses one public dispatcher for gateway paths and relays all other upgrades", () => {
  const gatewayUrls: string[] = [];
  const relayUrls: string[] = [];
  const destroyed: string[] = [];
  const gateway = {
    handleUpgrade(request: IncomingMessage) {
      gatewayUrls.push(request.url ?? "");
      return request.url?.startsWith("/api/events.") ?? false;
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
    nextUpgradeRelay: relay,
  });
  const socket = { destroy: () => destroyed.push("destroyed") } as unknown as Duplex;
  const head = Buffer.alloc(0);

  dispatch({ url: "/api/events.mux" } as IncomingMessage, socket, head);
  dispatch({ url: "/_next/webpack-hmr" } as IncomingMessage, socket, head);

  assert.deepEqual(gatewayUrls, ["/api/events.mux", "/_next/webpack-hmr"]);
  assert.deepEqual(relayUrls, ["/_next/webpack-hmr"]);
  assert.deepEqual(destroyed, []);

  const server = createWorkbenchHttpServer({
    requestHandler: () => undefined,
    webSocketGateway: gateway,
    nextUpgradeRelay: relay,
  });
  assert.equal(server.listenerCount("upgrade"), 1);
  server.close();
});

test("closes an unhandled upgrade when Next has no relay listener", () => {
  let missingUrl: string | undefined;
  let destroyed = false;
  const dispatch = createUpgradeDispatcher({
    webSocketGateway: { handleUpgrade: () => false },
    nextUpgradeRelay: { emit: () => false },
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
