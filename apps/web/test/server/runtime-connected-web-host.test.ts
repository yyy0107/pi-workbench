import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import test from "node:test";

import { RUNTIME_CONNECTION_PROTOCOL_VERSION } from "@workbench/host-contracts/runtime-connection";
import { WebHostShutdownReason } from "@workbench/host-contracts/web-host-control";
import {
  createWorkbenchHttpServer,
  type WorkbenchHttpServerOptions,
} from "@workbench/host-server/workbench-http-server";

import {
  RUNTIME_CONNECTED_WEB_HOST,
  RUNTIME_ARTIFACT_UPGRADE_PATHS,
  startRuntimeConnectedWebHost,
  type RuntimeConnectedWebHostDependencies,
} from "@/server/runtime-connected-web-host";

const WEB_ROOT = "/repository/apps/web";
const RUNTIME_UPGRADE_PATH = RUNTIME_ARTIFACT_UPGRADE_PATHS[0]!;
const ACCESS_TOKEN = "root-owned-runtime-secret";
const RUNTIME_CONNECTION = Object.freeze({
  kind: "desktop-sidecar" as const,
  protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
  httpOrigin: "http://127.0.0.1:43128",
  instanceId: "runtime-host-fixture",
  accessToken: ACCESS_TOKEN,
});

async function unusedLoopbackPort(): Promise<number> {
  const server = createServer();
  server.listen(0, RUNTIME_CONNECTED_WEB_HOST);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string" && address.port > 0);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

function rawUpgrade(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, RUNTIME_CONNECTED_WEB_HOST);
    const chunks: Buffer[] = [];
    socket.once("error", reject);
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("connect", () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: ${RUNTIME_CONNECTED_WEB_HOST}:${port}\r\nOrigin: http://${RUNTIME_CONNECTED_WEB_HOST}:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
      );
    });
    socket.once("close", () => resolve(Buffer.concat(chunks).toString()));
  });
}

test("routes Next, Runtime HTTP, exact Runtime upgrades, and HMR to their sole owners", async (t) => {
  assert.deepEqual(RUNTIME_ARTIFACT_UPGRADE_PATHS, [
    "/api/events.mux",
    "/api/events.host",
    "/api/terminal",
    "/api/browser/ws",
  ]);
  const port = await unusedLoopbackPort();
  const publicOrigin = `http://${RUNTIME_CONNECTED_WEB_HOST}:${port}`;
  const calls: string[] = [];
  let publicServer: Server | undefined;
  let accepting = true;
  let runtimeShutdownCalls = 0;
  const receivedProxyOptions: Parameters<
    NonNullable<RuntimeConnectedWebHostDependencies["createProxy"]>
  >[0][] = [];
  const proxyOwner = {
    handleHttp(
      request: Parameters<
        ReturnType<NonNullable<RuntimeConnectedWebHostDependencies["createProxy"]>>["handleHttp"]
      >[0],
      response: Parameters<
        ReturnType<NonNullable<RuntimeConnectedWebHostDependencies["createProxy"]>>["handleHttp"]
      >[1],
    ) {
      calls.push(`runtime:http:${request.url ?? ""}`);
      response.statusCode = 200;
      response.end("Runtime fixture");
    },
    handleUpgrade(
      request: Parameters<
        ReturnType<NonNullable<RuntimeConnectedWebHostDependencies["createProxy"]>>["handleUpgrade"]
      >[0],
      socket: Parameters<
        ReturnType<NonNullable<RuntimeConnectedWebHostDependencies["createProxy"]>>["handleUpgrade"]
      >[1],
    ) {
      calls.push(`runtime:upgrade:${request.url ?? ""}`);
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
      );
      socket.end();
      return true;
    },
    stopAdmission() {
      accepting = false;
      calls.push("runtime:stop-admission");
    },
    get accepting() {
      return accepting;
    },
    async shutdown() {
      runtimeShutdownCalls += 1;
    },
  };
  const dependencies: RuntimeConnectedWebHostDependencies = {
    createPublicServer(options: WorkbenchHttpServerOptions) {
      publicServer = createWorkbenchHttpServer(options);
      publicServer.once("close", () => calls.push("public:closed"));
      return publicServer;
    },
    async createNext(options) {
      assert.equal(options.dev, true);
      assert.equal(options.hostname, RUNTIME_CONNECTED_WEB_HOST);
      assert.equal(options.port, port);
      assert.equal(options.webRoot, WEB_ROOT);
      return {
        requestHandler(request, response) {
          calls.push(`next:http:${request.url ?? ""}`);
          response.statusCode = 200;
          response.end("Next fixture");
        },
        upgradeRelay: {
          emit(_event, request, socket) {
            calls.push(`next:upgrade:${request.url ?? ""}`);
            socket.write(
              "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
            );
            socket.end();
            return true;
          },
        },
        async close() {
          calls.push("next:close");
          assert.equal(accepting, false, "Runtime admission must already be stopped");
          assert.equal(publicServer?.listening, false, "public accepts must already be stopped");
          assert.equal(runtimeShutdownCalls, 0, "Web must not acquire Runtime lifecycle ownership");
        },
      };
    },
    createProxy(options) {
      receivedProxyOptions.push(options);
      calls.push("runtime:create-proxy");
      return proxyOwner;
    },
  };
  const running = await startRuntimeConnectedWebHost(
    {
      dev: true,
      hostname: RUNTIME_CONNECTED_WEB_HOST,
      port,
      publicOrigin,
      runtimeConnection: RUNTIME_CONNECTION,
      webRoot: WEB_ROOT,
    },
    dependencies,
  );
  t.after(() =>
    running
      .shutdown({ reason: WebHostShutdownReason.requested, deadlineMs: 5_000 })
      .catch(() => undefined),
  );

  assert.equal(receivedProxyOptions.length, 1);
  assert.equal(receivedProxyOptions[0]?.runtimeOrigin, RUNTIME_CONNECTION.httpOrigin);
  assert.equal(receivedProxyOptions[0]?.accessToken, ACCESS_TOKEN);
  assert.equal(receivedProxyOptions[0]?.publicOrigin, publicOrigin);
  assert.equal(typeof receivedProxyOptions[0]?.onUnexpectedError, "function");
  assert.equal(JSON.stringify(running).includes(ACCESS_TOKEN), false);
  assert.deepEqual(
    { host: running.host, port: running.port, httpOrigin: running.httpOrigin },
    { host: RUNTIME_CONNECTED_WEB_HOST, port, httpOrigin: publicOrigin },
  );

  const page = await fetch(`${publicOrigin}/workspace`);
  assert.equal(page.status, 200);
  assert.equal(await page.text(), "Next fixture");

  const api = await fetch(`${publicOrigin}/api/host.describe`);
  assert.equal(api.status, 200);
  assert.equal(await api.text(), "Runtime fixture");

  const runtimeUpgrade = await rawUpgrade(port, RUNTIME_UPGRADE_PATH);
  assert.match(runtimeUpgrade, /^HTTP\/1\.1 101 Switching Protocols/u);

  const nearRuntimeUpgrade = await rawUpgrade(port, `${RUNTIME_UPGRADE_PATH}/extra`);
  assert.equal(nearRuntimeUpgrade, "", "only the exact Runtime path may reach the proxy");

  const hmr = await rawUpgrade(port, "/_next/webpack-hmr");
  assert.match(hmr, /^HTTP\/1\.1 101 Switching Protocols/u);
  assert.deepEqual(
    calls.filter((call) => call.includes(":http:") || call.includes(":upgrade:")),
    [
      "next:http:/workspace",
      "runtime:http:/api/host.describe",
      `runtime:upgrade:${RUNTIME_UPGRADE_PATH}`,
      "next:upgrade:/_next/webpack-hmr",
    ],
  );

  const shutdown = running.shutdown({
    reason: WebHostShutdownReason.requested,
    deadlineMs: 5_000,
  });
  assert.equal(calls.at(-1), "runtime:stop-admission");
  await shutdown;
  assert.deepEqual(calls.slice(-3), ["runtime:stop-admission", "public:closed", "next:close"]);
  assert.equal(runtimeShutdownCalls, 0);
});

test("fails closed before Next or proxy construction when publicOrigin does not match the bind", async () => {
  const port = await unusedLoopbackPort();
  const mismatchedPort = port === 65_535 ? port - 1 : port + 1;
  let publicServer: Server | undefined;
  let nextCalls = 0;
  let proxyCalls = 0;

  await assert.rejects(
    startRuntimeConnectedWebHost(
      {
        dev: false,
        hostname: RUNTIME_CONNECTED_WEB_HOST,
        port,
        publicOrigin: `http://${RUNTIME_CONNECTED_WEB_HOST}:${mismatchedPort}`,
        runtimeConnection: RUNTIME_CONNECTION,
        webRoot: WEB_ROOT,
      },
      {
        createPublicServer(options) {
          publicServer = createWorkbenchHttpServer(options);
          return publicServer;
        },
        async createNext() {
          nextCalls += 1;
          throw new Error("Next must not be constructed");
        },
        createProxy() {
          proxyCalls += 1;
          throw new Error("Proxy must not be constructed");
        },
      },
    ),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Runtime-connected Web Host startup failed." &&
      !error.message.includes(ACCESS_TOKEN),
  );

  assert.equal(publicServer?.listening, false);
  assert.equal(publicServer?.address(), null);
  assert.equal(nextCalls, 0);
  assert.equal(proxyCalls, 0);
});
