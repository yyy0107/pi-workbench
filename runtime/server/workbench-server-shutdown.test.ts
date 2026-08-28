import assert from "node:assert/strict";
import test from "node:test";

import { createWorkbenchServerShutdown } from "./workbench-server-shutdown";

test("gracefully closes server resources once", async () => {
  const calls: string[] = [];
  const clients = new Set<{
    close(code: number, reason: string): void;
    terminate(): void;
  }>();
  clients.add({
    close(code, reason) {
      calls.push(`socket:${code}:${reason}`);
      clients.delete(this);
    },
    terminate() {
      calls.push("socket:terminate");
    },
  });
  const shutdown = createWorkbenchServerShutdown({
    httpServer: {
      close(callback) {
        calls.push("http:close");
        callback?.();
        return this as never;
      },
      closeIdleConnections() {
        calls.push("http:idle");
      },
      closeAllConnections() {
        calls.push("http:force");
      },
    },
    webSocketServers: [
      {
        clients: clients as never,
        close(callback) {
          calls.push("ws:close");
          callback?.();
        },
      },
    ],
    disposeRuntime: () => calls.push("runtime:dispose"),
    closeApplication: async () => {
      calls.push("next:close");
    },
    runShutdownHooks: async () => {
      calls.push("hooks:run");
      return [];
    },
    gracePeriodMs: 50,
  });

  const first = shutdown();
  assert.equal(shutdown(), first);
  assert.deepEqual(await first, { forced: false, errors: [] });
  assert.equal(calls.filter((call) => call === "runtime:dispose").length, 1);
  assert.ok(calls.includes("socket:1001:Workbench is shutting down"));
  assert.ok(!calls.includes("socket:terminate"));
  assert.ok(!calls.includes("http:force"));
});

test("forces remaining sockets and HTTP connections after the grace period", async () => {
  let terminated = false;
  let forcedHttp = false;
  const socket = {
    close() {},
    terminate() {
      terminated = true;
    },
  };
  const never = () => new Promise<unknown>(() => {});
  const shutdown = createWorkbenchServerShutdown({
    httpServer: {
      close() {
        return this as never;
      },
      closeAllConnections() {
        forcedHttp = true;
      },
    },
    webSocketServers: [
      {
        clients: new Set([socket]) as never,
        close() {},
      },
    ],
    disposeRuntime() {},
    closeApplication() {},
    runShutdownHooks: never as () => Promise<unknown[]>,
    gracePeriodMs: 1,
    forcePeriodMs: 1,
  });

  assert.deepEqual(await shutdown(), { forced: true, errors: [] });
  assert.equal(terminated, true);
  assert.equal(forcedHttp, true);
});
