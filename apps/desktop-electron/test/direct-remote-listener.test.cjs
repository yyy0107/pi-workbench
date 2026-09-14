const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  MAXIMUM_SOCKET_BUFFER_BYTES,
  createDirectSocketAdapter,
  createDirectRemoteListener,
  listDirectNetworkInterfaces,
} = require("../src/direct-remote-listener.cjs");

const networkInterfaces = () => ({
  eth0: [
    { address: "192.168.10.4", family: "IPv4", internal: false },
    { address: "fe80::1", family: "IPv6", internal: false },
  ],
  tailscale0: [
    { address: "100.70.8.9", family: 4, internal: false },
    { address: "fd7a:115c:a1e0::1234", family: 6, internal: false },
  ],
  lo: [{ address: "127.0.0.1", family: 4, internal: true }],
});

function createListenerHarness() {
  const active = new Set();
  const records = [];
  const failures = new Set();
  const http = {
    createServer(handler) {
      const server = Object.assign(new EventEmitter(), {
        listening: false,
        listen({ host, port }) {
          const key = `${host}:${port}`;
          records.push(["listen", key]);
          if (failures.has(key) || active.has(key)) {
            queueMicrotask(() => server.emit("error", new Error("EADDRINUSE")));
            return;
          }
          active.add(key);
          server.key = key;
          server.listening = true;
          queueMicrotask(() => server.emit("listening"));
        },
        close(callback) {
          records.push(["close", server.key]);
          if (server.key) active.delete(server.key);
          server.listening = false;
          callback?.();
        },
        closeAllConnections() {},
        requestHandler: handler,
      });
      return server;
    },
  };
  class WebSocketServerMock extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
    }
    close() {}
    handleUpgrade() {}
  }
  return {
    active,
    failures,
    records,
    listener: createDirectRemoteListener({
      http,
      WebSocketServer: WebSocketServerMock,
      networkInterfaces,
    }),
  };
}

test("enumerates only stable private LAN and Tailscale interface identities", async () => {
  const values = await listDirectNetworkInterfaces(networkInterfaces);
  assert.deepEqual(
    values.map(({ address, kind }) => [address, kind]),
    [
      ["192.168.10.4", "local-network"],
      ["100.70.8.9", "tailscale"],
      ["fd7a:115c:a1e0::1234", "tailscale"],
    ],
  );
  assert.equal(new Set(values.map((value) => value.interfaceId)).size, values.length);
  assert.equal(JSON.stringify(values).includes("127.0.0.1"), false);
  assert.equal(JSON.stringify(values).includes("fe80::1"), false);
});

test("validates selected interfaces and atomically reuses unchanged bindings", async () => {
  const harness = createListenerHarness();
  const addresses = await harness.listener.listInterfaces();
  const lan = addresses.find((value) => value.address === "192.168.10.4");
  assert.ok(lan);

  await assert.rejects(
    () =>
      harness.listener.prepare({
        addresses: [{ ...lan, address: "192.168.10.99" }],
        port: 8787,
        path: "/remote/v1/direct",
        onSocket() {},
      }),
    /interface_disappeared/u,
  );

  const first = await harness.listener.prepare({
    addresses: [lan],
    port: 8787,
    path: "/remote/v1/direct",
    onSocket() {},
  });
  const firstHandle = await first.commit();
  assert.deepEqual([...harness.active], ["192.168.10.4:8787"]);

  const replacement = await harness.listener.prepare({
    addresses: [lan],
    port: 8787,
    path: "/remote/v1/direct",
    onSocket() {},
  });
  const replacementHandle = await replacement.commit();
  assert.equal(harness.records.filter(([kind]) => kind === "listen").length, 1);
  await firstHandle.dispose();
  assert.deepEqual([...harness.active], ["192.168.10.4:8787"]);
  await replacementHandle.dispose();
  assert.deepEqual([...harness.active], []);
});

test("rolls back every candidate binding and preserves the active generation on conflict", async () => {
  const harness = createListenerHarness();
  const addresses = await harness.listener.listInterfaces();
  const lan = addresses.find((value) => value.address === "192.168.10.4");
  const tail = addresses.find((value) => value.address === "100.70.8.9");
  assert.ok(lan && tail);

  const first = await harness.listener.prepare({
    addresses: [lan],
    port: 8787,
    path: "/remote/v1/direct",
    onSocket() {},
  });
  await first.commit();
  harness.failures.add("100.70.8.9:9000");
  await assert.rejects(
    () =>
      harness.listener.prepare({
        addresses: [lan, tail],
        port: 9000,
        path: "/remote/v1/direct",
        onSocket() {},
      }),
    /bind_failed/u,
  );
  assert.deepEqual([...harness.active], ["192.168.10.4:8787"]);
  assert.ok(harness.records.some(([kind, key]) => kind === "close" && key === "192.168.10.4:9000"));

  await harness.listener.dispose();
  assert.deepEqual([...harness.active], []);
});

test("bounds queued output and closes a send that remains backpressured", async () => {
  const closes = [];
  const stalled = Object.assign(new EventEmitter(), {
    readyState: 1,
    bufferedAmount: 0,
    send() {},
    close(code, reason) {
      closes.push([code, reason]);
    },
  });
  const stalledAdapter = createDirectSocketAdapter(stalled, "192.168.10.5", {
    sendBackpressureTimeoutMs: 5,
  });
  await assert.rejects(() => stalledAdapter.send("bounded"), /backpressured/u);
  assert.deepEqual(closes, [[1008, "slow_consumer"]]);

  const full = Object.assign(new EventEmitter(), {
    readyState: 1,
    bufferedAmount: MAXIMUM_SOCKET_BUFFER_BYTES,
    send() {
      assert.fail("an over-cap frame must not be queued");
    },
    close(code, reason) {
      closes.push([code, reason]);
    },
  });
  const fullAdapter = createDirectSocketAdapter(full, "192.168.10.6");
  await assert.rejects(() => fullAdapter.send("x"), /backpressured/u);
  assert.deepEqual(closes.at(-1), [1008, "slow_consumer"]);
});
