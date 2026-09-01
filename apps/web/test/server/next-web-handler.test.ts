import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse, type Server } from "node:http";
import { Socket } from "node:net";
import test from "node:test";

import { createUpgradeDispatcher } from "@workbench/host-server/workbench-http-server";

import { createNextWebHandler } from "@/server/next-web-handler";

const WEB_ROOT = "/repository/apps/web";

interface FakeNextState {
  carrier?: Server;
  closeCount: number;
  requestCount: number;
  upgradeCount: number;
  upgradeOperations: Promise<void>[];
}

function createRequest(url: string): IncomingMessage {
  const request = new IncomingMessage(new Socket());
  request.method = "GET";
  request.url = url;
  request.headers.host = "127.0.0.1:3210";
  return request;
}

function createFakeNextFactory(
  state: FakeNextState,
  options: { readonly prepareError?: Error; readonly closeError?: Error } = {},
) {
  return (applicationOptions: { readonly dir: string; readonly httpServer: Server }) => {
    assert.equal(applicationOptions.dir, WEB_ROOT);
    state.carrier = applicationOptions.httpServer;
    let prepared = false;
    let lazyUpgradeListenerInstalled = false;
    const handleUpgrade = () => {
      const operation = Promise.resolve().then(() => {
        state.upgradeCount += 1;
      });
      state.upgradeOperations.push(operation);
      return operation;
    };

    return {
      getRequestHandler() {
        return async () => {
          state.requestCount += 1;
          if (!lazyUpgradeListenerInstalled) {
            lazyUpgradeListenerInstalled = true;
            applicationOptions.httpServer.on("upgrade", () => {
              void handleUpgrade();
            });
          }
        };
      },
      getUpgradeHandler() {
        assert.equal(prepared, true);
        return handleUpgrade;
      },
      async prepare() {
        applicationOptions.httpServer.on("upgrade", () => undefined);
        if (options.prepareError) throw options.prepareError;
        applicationOptions.httpServer.removeAllListeners("upgrade");
        prepared = true;
      },
      async close() {
        state.closeCount += 1;
        if (options.closeError) throw options.closeError;
      },
    };
  };
}

function createState(): FakeNextState {
  return { closeCount: 0, requestCount: 0, upgradeCount: 0, upgradeOperations: [] };
}

test("relays upgrades through the listener Next installs on its carrier", async () => {
  const state = createState();
  const nextWeb = await createNextWebHandler(
    { dev: false, hostname: "127.0.0.1", port: 3210, webRoot: WEB_ROOT },
    createFakeNextFactory(state),
  );
  const carrier = state.carrier!;
  assert.equal(carrier.listening, false);
  assert.equal(carrier.listenerCount("upgrade"), 0);

  const firstRequest = createRequest("/_next/webpack-hmr");
  const firstSocket = firstRequest.socket;
  assert.equal(
    nextWeb.upgradeRelay.emit("upgrade", firstRequest, firstSocket, Buffer.alloc(0)),
    false,
  );
  assert.equal(state.upgradeOperations.length, 0);

  const ordinaryRequest = createRequest("/");
  const ordinaryResponse = new ServerResponse(ordinaryRequest);
  await nextWeb.requestHandler(ordinaryRequest, ordinaryResponse);
  assert.equal(state.requestCount, 1);
  assert.equal(carrier.listenerCount("upgrade"), 1);

  const secondRequest = createRequest("/_next/webpack-hmr");
  const secondSocket = secondRequest.socket;
  assert.equal(
    nextWeb.upgradeRelay.emit("upgrade", secondRequest, secondSocket, Buffer.alloc(0)),
    true,
  );
  assert.equal(state.upgradeOperations.length, 1);
  await state.upgradeOperations[0];
  assert.equal(state.upgradeCount, 1);

  ordinaryResponse.destroy();
  firstSocket.destroy();
  secondSocket.destroy();
  await nextWeb.close();
});

test("keeps Runtime upgrade paths Host-owned and only relays non-Runtime paths to Next", async () => {
  const state = createState();
  const nextWeb = await createNextWebHandler(
    { dev: false, hostname: "127.0.0.1", port: 3210, webRoot: WEB_ROOT },
    createFakeNextFactory(state),
  );
  const ordinaryRequest = createRequest("/");
  const ordinaryResponse = new ServerResponse(ordinaryRequest);
  await nextWeb.requestHandler(ordinaryRequest, ordinaryResponse);
  let runtimeUpgradeCount = 0;
  const dispatchUpgrade = createUpgradeDispatcher({
    webSocketGateway: {
      handleUpgrade() {
        runtimeUpgradeCount += 1;
        return true;
      },
    },
    nonRuntimeUpgradeRelay: nextWeb.upgradeRelay,
    upgradeRequiredPaths: ["/api/runtime.ws"],
  });

  const runtimeRequest = createRequest("/api/runtime.ws");
  const runtimeSocket = runtimeRequest.socket;
  dispatchUpgrade(runtimeRequest, runtimeSocket, Buffer.alloc(0));
  assert.equal(runtimeUpgradeCount, 1);
  assert.equal(state.upgradeOperations.length, 0);
  assert.equal(state.upgradeCount, 0);

  const nextRequest = createRequest("/_next/webpack-hmr");
  const nextSocket = nextRequest.socket;
  dispatchUpgrade(nextRequest, nextSocket, Buffer.alloc(0));
  assert.equal(runtimeUpgradeCount, 1);
  assert.equal(state.upgradeOperations.length, 1);
  await state.upgradeOperations[0];
  assert.equal(state.upgradeCount, 1);

  runtimeSocket.destroy();
  nextSocket.destroy();
  ordinaryResponse.destroy();
  await nextWeb.close();
});

test("closes once, clears the inert Next carrier, and fails the public relay closed", async () => {
  const state = createState();
  const nextWeb = await createNextWebHandler(
    { dev: false, hostname: "127.0.0.1", port: 3210, webRoot: WEB_ROOT },
    createFakeNextFactory(state),
  );
  const ordinaryRequest = createRequest("/");
  const ordinaryResponse = new ServerResponse(ordinaryRequest);
  await nextWeb.requestHandler(ordinaryRequest, ordinaryResponse);
  assert.equal(state.carrier!.listenerCount("upgrade"), 1);

  const firstClose = nextWeb.close();
  const secondClose = nextWeb.close();
  assert.equal(firstClose, secondClose);
  await firstClose;
  assert.equal(state.closeCount, 1);
  assert.equal(state.carrier!.listenerCount("upgrade"), 0);

  const lateRequest = createRequest("/_next/webpack-hmr");
  const lateSocket = lateRequest.socket;
  assert.equal(
    nextWeb.upgradeRelay.emit("upgrade", lateRequest, lateSocket, Buffer.alloc(0)),
    false,
  );
  assert.equal(state.upgradeCount, 0);

  ordinaryResponse.destroy();
  lateSocket.destroy();
});

test("closes a partially prepared Next application and clears its carrier on prepare failure", async () => {
  const state = createState();
  const prepareError = new Error("prepare failed");

  await assert.rejects(
    createNextWebHandler(
      { dev: false, hostname: "127.0.0.1", port: 3210, webRoot: WEB_ROOT },
      createFakeNextFactory(state, { prepareError }),
    ),
    (error) => error === prepareError,
  );
  assert.equal(state.closeCount, 1);
  assert.equal(state.carrier!.listenerCount("upgrade"), 0);
  assert.equal(state.carrier!.listening, false);
});

test("preserves both preparation and cleanup failures", async () => {
  const state = createState();
  const prepareError = new Error("prepare failed");
  const closeError = new Error("close failed");

  await assert.rejects(
    createNextWebHandler(
      { dev: false, hostname: "127.0.0.1", port: 3210, webRoot: WEB_ROOT },
      createFakeNextFactory(state, { prepareError, closeError }),
    ),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [prepareError, closeError]);
      return true;
    },
  );
  assert.equal(state.closeCount, 1);
  assert.equal(state.carrier!.listenerCount("upgrade"), 0);
});
