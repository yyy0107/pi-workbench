import assert from "node:assert/strict";
import test from "node:test";

import type { MobileAppState } from "../src/platform/app-state.ts";
import type { MobileNetworkState } from "../src/platform/network.ts";
import { createMobileRemoteClient } from "../src/state/remote-client.ts";

function harness(initialAppState: MobileAppState = "active") {
  let appState = initialAppState;
  let network: MobileNetworkState = { connected: true, reachable: true };
  let lifecycleListener: ((value: MobileAppState) => void) | undefined;
  let networkListener: ((value: MobileNetworkState) => void) | undefined;
  const connects: string[] = [];
  const suspends: string[] = [];
  const timers: Array<() => void> = [];
  const client = createMobileRemoteClient({
    lifecycle: {
      current: () => appState,
      subscribe: (listener) => {
        lifecycleListener = listener;
        return () => void (lifecycleListener = undefined);
      },
    },
    network: {
      current: async () => network,
      subscribe: (listener) => {
        networkListener = listener;
        return () => void (networkListener = undefined);
      },
    },
    transport: {
      connect: async ({ reason }) => void connects.push(reason),
      suspend: (reason) => void suspends.push(reason),
    },
    random: () => 0.999,
    timer: {
      set: (callback) => {
        timers.push(callback);
        return callback;
      },
      clear: (handle) => {
        const index = timers.indexOf(handle as () => void);
        if (index >= 0) timers.splice(index, 1);
      },
    },
  });
  return {
    client,
    connects,
    suspends,
    timers,
    app(next: MobileAppState) {
      appState = next;
      lifecycleListener?.(next);
    },
    net(next: MobileNetworkState) {
      network = next;
      networkListener?.(next);
    },
  };
}

test("connects only while active and performs immediate foreground or network recovery", async () => {
  const value = harness("background");
  await value.client.start();
  assert.deepEqual(value.connects, []);

  value.app("active");
  await Promise.resolve();
  assert.deepEqual(value.connects, ["foreground"]);
  value.client.markReady();

  value.net({ connected: false, reachable: false });
  assert.equal(value.client.snapshot().status, "offline");
  assert.equal(value.suspends.at(-1), "network-offline");
  value.net({ connected: true, reachable: true });
  await Promise.resolve();
  assert.deepEqual(value.connects, ["foreground", "network"]);

  value.app("background");
  assert.equal(value.suspends.at(-1), "background");
  assert.deepEqual(value.connects, ["foreground", "network"]);
});

test("stops heartbeats/reconnects in background and keeps retry scheduling bounded", async () => {
  const value = harness();
  await value.client.start();
  assert.deepEqual(value.connects, ["start"]);
  value.client.markDisconnected({ unresolvedOutcome: true });
  assert.equal(value.client.snapshot().status, "outcome-checking");
  assert.equal(value.timers.length, 1);

  value.app("background");
  assert.equal(value.timers.length, 0);
  assert.equal(value.suspends.at(-1), "background");

  value.app("active");
  await Promise.resolve();
  assert.deepEqual(value.connects, ["start", "foreground"]);
  value.client.stop();
  assert.equal(value.suspends.at(-1), "stopped");
});
