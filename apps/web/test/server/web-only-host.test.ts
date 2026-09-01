import assert from "node:assert/strict";
import { once } from "node:events";
import { type Server } from "node:http";
import { connect } from "node:net";
import test from "node:test";

import {
  createWorkbenchHttpServer,
  type WorkbenchHttpServerOptions,
} from "@workbench/host-server/workbench-http-server";
import { WebHostShutdownReason } from "@workbench/host-contracts/web-host-control";

import {
  WEB_ONLY_HOST,
  startWebOnlyHost,
  type WebOnlyHostDependencies,
} from "@/server/web-only-host";

const WEB_ROOT = "/artifact/apps/web";

function rawUpgrade(
  port: number,
  path: string,
  options: { readonly keepOpen?: boolean } = {},
): Promise<{ readonly response: string; readonly socketClosed: Promise<void> }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, WEB_ONLY_HOST);
    const chunks: Buffer[] = [];
    const socketClosed = once(socket, "close").then(() => undefined);
    socket.once("error", reject);
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("connect", () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: ${WEB_ONLY_HOST}:${port}\r\nOrigin: http://${WEB_ONLY_HOST}:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
      );
    });
    if (options.keepOpen) {
      socket.once("data", () =>
        resolve({ response: Buffer.concat(chunks).toString(), socketClosed }),
      );
    } else {
      socket.once("close", () =>
        resolve({ response: Buffer.concat(chunks).toString(), socketClosed }),
      );
    }
  });
}

function fixtureDependencies(state: {
  nextRequests: string[];
  nextUpgrades: string[];
  nextCloses: number;
}): WebOnlyHostDependencies {
  return {
    async createNext(options) {
      assert.equal(options.dev, false);
      assert.equal(options.hostname, WEB_ONLY_HOST);
      assert.ok(options.port > 0, "Next must receive the actual random public port");
      assert.equal(options.webRoot, WEB_ROOT);
      return {
        requestHandler(request, response) {
          state.nextRequests.push(request.url ?? "");
          response.statusCode = 200;
          response.end("Next fixture");
        },
        upgradeRelay: {
          emit(_event, request, socket) {
            state.nextUpgrades.push(request.url ?? "");
            socket.write(
              "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
            );
            socket.end();
            return true;
          },
        },
        async close() {
          state.nextCloses += 1;
        },
      };
    },
  };
}

test("serves Next and HMR while every Runtime HTTP/Upgrade path fails closed", async (t) => {
  const state = { nextRequests: [] as string[], nextUpgrades: [] as string[], nextCloses: 0 };
  const running = await startWebOnlyHost(
    { dev: false, hostname: WEB_ONLY_HOST, port: 0, webRoot: WEB_ROOT },
    fixtureDependencies(state),
  );
  t.after(() =>
    running
      .shutdown({ reason: WebHostShutdownReason.requested, deadlineMs: 5_000 })
      .catch(() => undefined),
  );

  const page = await fetch(`${running.httpOrigin}/`);
  assert.equal(page.status, 200);
  assert.equal(await page.text(), "Next fixture");

  const api = await fetch(`${running.httpOrigin}/api/host.describe`);
  assert.equal(api.status, 503);
  assert.equal(api.headers.get("cache-control"), "no-store");
  assert.equal(await api.text(), "Runtime unavailable.");
  assert.deepEqual(state.nextRequests, ["/"]);

  const hmr = await rawUpgrade(running.port, "/_next/webpack-hmr");
  assert.match(hmr.response, /^HTTP\/1\.1 101 Switching Protocols/u);
  assert.deepEqual(state.nextUpgrades, ["/_next/webpack-hmr"]);

  const runtimeUpgrade = await rawUpgrade(running.port, "/api/events.mux");
  assert.equal(runtimeUpgrade.response, "");
  assert.deepEqual(state.nextUpgrades, ["/_next/webpack-hmr"]);

  await running.shutdown({ reason: WebHostShutdownReason.requested, deadlineMs: 5_000 });
  assert.equal(state.nextCloses, 1);
});

test("binds first but returns 503 until Next preparation transfers admission", async (t) => {
  let preparedPort = 0;
  let releasePrepare!: () => void;
  const prepareGate = new Promise<void>((resolve) => (releasePrepare = resolve));
  const start = startWebOnlyHost(
    { dev: false, hostname: WEB_ONLY_HOST, port: 0, webRoot: WEB_ROOT },
    {
      async createNext(options) {
        preparedPort = options.port;
        await prepareGate;
        return {
          requestHandler(_request, response) {
            response.statusCode = 204;
            response.end();
          },
          upgradeRelay: { emit: () => true },
          close: async () => undefined,
        };
      },
    },
  );
  while (preparedPort === 0) await new Promise<void>((resolve) => setImmediate(resolve));

  const early = await fetch(`http://${WEB_ONLY_HOST}:${preparedPort}/`);
  assert.equal(early.status, 503);
  assert.equal(early.headers.get("cache-control"), "no-store");
  releasePrepare();
  const running = await start;
  t.after(() =>
    running
      .shutdown({ reason: WebHostShutdownReason.requested, deadlineMs: 5_000 })
      .catch(() => undefined),
  );
  const ready = await fetch(`${running.httpOrigin}/`);
  assert.equal(ready.status, 204);
});

test("stops admission and public sockets before closing Next", async (t) => {
  const calls: string[] = [];
  let publicServer: Server | undefined;
  let upgradedSocketClosed: Promise<void> | undefined;
  const running = await startWebOnlyHost(
    { dev: false, hostname: WEB_ONLY_HOST, port: 0, webRoot: WEB_ROOT },
    {
      createPublicServer(options: WorkbenchHttpServerOptions) {
        publicServer = createWorkbenchHttpServer(options);
        publicServer.once("close", () => calls.push("public:closed"));
        return publicServer;
      },
      async createNext() {
        return {
          requestHandler(_request, response) {
            response.statusCode = 204;
            response.end();
          },
          upgradeRelay: {
            emit(_event, _request, socket) {
              socket.write(
                "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
              );
              return true;
            },
          },
          async close() {
            calls.push("next:close");
            assert.equal(publicServer?.listening, false);
            await upgradedSocketClosed;
          },
        };
      },
    },
  );
  t.after(() =>
    running
      .shutdown({ reason: WebHostShutdownReason.requested, deadlineMs: 5_000 })
      .catch(() => undefined),
  );
  const upgraded = await rawUpgrade(running.port, "/_next/webpack-hmr", { keepOpen: true });
  upgradedSocketClosed = upgraded.socketClosed;

  const first = running.shutdown({
    reason: WebHostShutdownReason.requested,
    deadlineMs: 5_000,
  });
  const second = running.shutdown({ reason: WebHostShutdownReason.restart, deadlineMs: 1 });
  assert.equal(first, second);
  await first;
  assert.deepEqual(calls, ["public:closed", "next:close"]);
});

test("closes the bound public listener when Next preparation fails", async () => {
  let publicServer: Server | undefined;
  await assert.rejects(
    startWebOnlyHost(
      { dev: false, hostname: WEB_ONLY_HOST, port: 0, webRoot: WEB_ROOT },
      {
        createPublicServer(options) {
          publicServer = createWorkbenchHttpServer(options);
          return publicServer;
        },
        async createNext() {
          throw new Error("sensitive Next diagnostic");
        },
      },
    ),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Web Host startup failed." &&
      !error.message.includes("sensitive"),
  );
  assert.equal(publicServer?.listening, false);
});

test("aborts pending preparation, closes the listener, and disposes a late Next owner", async () => {
  const startupController = new AbortController();
  let publicServer: Server | undefined;
  let preparedPort = 0;
  let releasePrepare!: () => void;
  const prepareGate = new Promise<void>((resolve) => (releasePrepare = resolve));
  let nextCloses = 0;
  const start = startWebOnlyHost(
    {
      dev: false,
      hostname: WEB_ONLY_HOST,
      port: 0,
      startupSignal: startupController.signal,
      webRoot: WEB_ROOT,
    },
    {
      createPublicServer(options) {
        publicServer = createWorkbenchHttpServer(options);
        return publicServer;
      },
      async createNext(options) {
        preparedPort = options.port;
        await prepareGate;
        return {
          requestHandler(_request, response) {
            response.statusCode = 204;
            response.end();
          },
          upgradeRelay: { emit: () => true },
          async close() {
            nextCloses += 1;
          },
        };
      },
    },
  );
  while (preparedPort === 0) await new Promise<void>((resolve) => setImmediate(resolve));

  startupController.abort();
  releasePrepare();
  await assert.rejects(start, /Web Host startup failed/u);
  assert.equal(publicServer?.listening, false);
  assert.equal(nextCloses, 1);
  await assert.rejects(fetch(`http://${WEB_ONLY_HOST}:${preparedPort}/`));
});

test("bounds a Next close that never settles and never reopens public admission", async () => {
  const running = await startWebOnlyHost(
    { dev: false, hostname: WEB_ONLY_HOST, port: 0, webRoot: WEB_ROOT },
    {
      async createNext() {
        return {
          requestHandler(_request, response) {
            response.statusCode = 204;
            response.end();
          },
          upgradeRelay: { emit: () => true },
          close: () => new Promise<void>(() => undefined),
        };
      },
    },
  );
  await assert.rejects(
    running.shutdown({ reason: WebHostShutdownReason.requested, deadlineMs: 20 }),
    /Web application Host shutdown deadline expired/u,
  );
  await assert.rejects(fetch(`${running.httpOrigin}/`));
});
