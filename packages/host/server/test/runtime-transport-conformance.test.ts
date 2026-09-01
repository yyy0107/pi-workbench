import assert from "node:assert/strict";
import { once } from "node:events";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";

import {
  RUNTIME_CONNECTION_PROTOCOL_VERSION,
  defineRuntimeConnection,
} from "@workbench/host-contracts";
import {
  createRuntimeFetch,
  createRuntimeWebSocket,
  type RuntimeWebSocket,
} from "@workbench/host-client";

import { createWorkbenchHttpServer } from "../src/workbench-http-server";
import {
  createAuthenticatedNoServerWebSocketServer,
  defineDesktopSidecarRuntimeAuthPolicy,
} from "../src/runtime-transport-auth";

const RENDERER_ORIGIN = "https://renderer.workbench.test";
const RUNTIME_WEBSOCKET_PATH = "/api/runtime.echo";

test("runs the Host client through real sidecar HTTP, upgrade, auth, and business framing", async () => {
  const instanceId = "runtime-conformance";
  const accessToken = "conformance-secret";
  const authPolicy = defineDesktopSidecarRuntimeAuthPolicy({
    instanceId,
    accessToken,
    allowedOrigins: [RENDERER_ORIGIN],
  });
  const rawWebSocketServer = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const authenticatedWebSocketServer = createAuthenticatedNoServerWebSocketServer({
    authPolicy,
    webSocketServer: rawWebSocketServer,
  });
  let businessConnections = 0;
  let delegatedAuthorization: string | string[] | undefined;
  let delegatedOrigin: string | string[] | undefined;
  const webSocketGateway = {
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
      if (new URL(request.url ?? "/", "http://localhost").pathname !== RUNTIME_WEBSOCKET_PATH) {
        return false;
      }
      authenticatedWebSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        businessConnections += 1;
        webSocket.on("message", (raw) => webSocket.send(`echo:${raw.toString()}`));
      });
      return true;
    },
  };
  const server = createWorkbenchHttpServer({
    desktopSidecarAuth: authPolicy,
    requestHandler(request, response) {
      delegatedAuthorization = request.headers.authorization;
      delegatedOrigin = request.headers.origin;
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true }));
    },
    webSocketGateway,
    nonRuntimeUpgradeRelay: { emit: () => false },
    upgradeRequiredPaths: [RUNTIME_WEBSOCKET_PATH],
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const connection = defineRuntimeConnection({
    kind: "desktop-sidecar",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    httpOrigin: `http://127.0.0.1:${port}`,
    instanceId,
    accessToken,
  });
  assert.equal(connection.kind, "desktop-sidecar");

  let client: RuntimeWebSocket | undefined;
  try {
    const response = await createRuntimeFetch(connection)("/api/identity", {
      headers: { Origin: RENDERER_ORIGIN },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), RENDERER_ORIGIN);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(delegatedAuthorization, undefined);
    assert.equal(delegatedOrigin, `http://127.0.0.1:${port}`);

    let rawClientUrl = "";
    client = createRuntimeWebSocket(connection, RUNTIME_WEBSOCKET_PATH, {
      webSocketFactory(url) {
        rawClientUrl = url;
        return new WebSocket(url, { headers: { Origin: RENDERER_ORIGIN } }) as RuntimeWebSocket;
      },
    });
    const opened = new Promise<void>((resolve, reject) => {
      client!.onopen = () => resolve();
      client!.onerror = (error) => reject(error);
    });
    await opened;
    assert.equal(businessConnections, 1);
    assert.equal(rawClientUrl, `ws://127.0.0.1:${port}${RUNTIME_WEBSOCKET_PATH}`);
    assert.equal(rawClientUrl.includes(accessToken), false);

    const businessMessage = new Promise<unknown>((resolve) => {
      client!.onmessage = (event) => resolve(event.data);
    });
    client.send("business-frame");
    const echoed = await businessMessage;
    assert.equal(String(echoed), "echo:business-frame");

    const rejectedClient = new WebSocket(`ws://127.0.0.1:${port}${RUNTIME_WEBSOCKET_PATH}`, {
      headers: { Origin: "https://attacker.test" },
    });
    const rejectedStatus = await new Promise<number>((resolve, reject) => {
      rejectedClient.once("unexpected-response", (_request, rejectedResponse) => {
        rejectedResponse.resume();
        resolve(rejectedResponse.statusCode ?? 0);
      });
      rejectedClient.once("error", reject);
    });
    assert.equal(rejectedStatus, 403);
    assert.equal(businessConnections, 1);
  } finally {
    client?.close();
    for (const webSocket of rawWebSocketServer.clients) webSocket.terminate();
    await new Promise<void>((resolve) => rawWebSocketServer.close(() => resolve()));
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
