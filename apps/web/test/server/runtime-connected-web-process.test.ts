import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";

import {
  createWorkbenchHostShutdownMessage,
  parseWorkbenchHostReadyMessage,
} from "@workbench/host-contracts/host-control";
import {
  RuntimeConnectedWebMode,
  createRuntimeConnectedWebStartMessage,
} from "@workbench/host-contracts/runtime-connected-web-control";
import { RUNTIME_CONNECTION_PROTOCOL_VERSION } from "@workbench/host-contracts/runtime-connection";
import { WebHostShutdownReason } from "@workbench/host-contracts/web-host-control";

import {
  runRuntimeConnectedWebProcess,
  type RuntimeConnectedWebProcessControl,
} from "@/server/runtime-connected-web-process";
import {
  RUNTIME_CONNECTED_WEB_HOST,
  type RunningRuntimeConnectedWebHost,
  type RuntimeConnectedWebHostShutdownOptions,
  type StartRuntimeConnectedWebHostOptions,
} from "@/server/runtime-connected-web-host";

const WEB_ROOT = path.resolve("/repository/apps/web");
const PUBLIC_ORIGIN = "http://127.0.0.1:43127";
const ACCESS_TOKEN = "root-owned-runtime-secret";
const RUNTIME_CONNECTION = Object.freeze({
  kind: "desktop-sidecar" as const,
  protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
  httpOrigin: "http://127.0.0.1:43128",
  instanceId: "runtime-process-fixture",
  accessToken: ACCESS_TOKEN,
});

function startMessage(
  mode: (typeof RuntimeConnectedWebMode)[keyof typeof RuntimeConnectedWebMode],
) {
  return createRuntimeConnectedWebStartMessage({
    mode,
    publicOrigin: PUBLIC_ORIGIN,
    runtimeConnection: RUNTIME_CONNECTION,
  });
}

class FakeProcessControl extends EventEmitter implements RuntimeConnectedWebProcessControl {
  readonly pid = 43_127;
  exitCode: number | undefined;
  connected = true;
  readonly sent: unknown[] = [];
  disconnectCalls = 0;

  send(message: unknown, callback?: (error: Error | null) => void): boolean {
    this.sent.push(message);
    callback?.(null);
    return true;
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    this.connected = false;
  }

  disconnectFromParent(): void {
    this.connected = false;
    this.emit("disconnect");
  }
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail(`Timed out waiting for ${label}.`);
}

function runningFixture(
  shutdownCalls: RuntimeConnectedWebHostShutdownOptions[],
): RunningRuntimeConnectedWebHost {
  const shutdown = Promise.resolve();
  return Object.freeze({
    host: RUNTIME_CONNECTED_WEB_HOST,
    port: 43_127,
    httpOrigin: PUBLIC_ORIGIN,
    shutdown(options: RuntimeConnectedWebHostShutdownOptions) {
      shutdownCalls.push(options);
      return shutdown;
    },
  });
}

test("maps exact development and production start IPC to one credential-free ready owner", async (t) => {
  for (const mode of Object.values(RuntimeConnectedWebMode)) {
    await t.test(mode, async () => {
      const processControl = new FakeProcessControl();
      const exits: number[] = [];
      const shutdownCalls: RuntimeConnectedWebHostShutdownOptions[] = [];
      const running = runningFixture(shutdownCalls);
      let captured: StartRuntimeConnectedWebHostOptions | undefined;
      const processRun = runRuntimeConnectedWebProcess({
        environment: { NODE_ENV: "test", WORKBENCH_WEB_ROOT: WEB_ROOT },
        processControl,
        forceExit: (code) => exits.push(code),
        shutdownTimeoutMs: 4_321,
        async startHost(options) {
          captured = options;
          return running;
        },
      });
      processControl.emit("message", startMessage(mode));
      await waitFor(() => processControl.sent.length === 1, `${mode} ready IPC`);

      assert.ok(captured);
      assert.deepEqual(
        {
          dev: captured.dev,
          hostname: captured.hostname,
          port: captured.port,
          publicOrigin: captured.publicOrigin,
          runtimeConnection: captured.runtimeConnection,
          webRoot: captured.webRoot,
          startupAborted: captured.startupSignal?.aborted,
        },
        {
          dev: mode === RuntimeConnectedWebMode.development,
          hostname: RUNTIME_CONNECTED_WEB_HOST,
          port: 43_127,
          publicOrigin: PUBLIC_ORIGIN,
          runtimeConnection: RUNTIME_CONNECTION,
          webRoot: WEB_ROOT,
          startupAborted: false,
        },
      );
      const ready = parseWorkbenchHostReadyMessage(processControl.sent[0]);
      assert.deepEqual(ready, {
        type: "workbench:ready",
        version: 1,
        host: RUNTIME_CONNECTED_WEB_HOST,
        port: 43_127,
        pid: processControl.pid,
      });
      assert.equal(`http://${ready?.host}:${ready?.port}`, PUBLIC_ORIGIN);
      assert.equal(JSON.stringify(processControl.sent).includes(ACCESS_TOKEN), false);
      assert.equal(JSON.stringify(running).includes(ACCESS_TOKEN), false);

      processControl.emit("message", createWorkbenchHostShutdownMessage());
      await processRun;
      assert.deepEqual(shutdownCalls, [
        { reason: WebHostShutdownReason.requested, deadlineMs: 4_321 },
      ]);
      assert.equal(processControl.exitCode, 0);
      assert.deepEqual(exits, [0]);
      assert.equal(processControl.disconnectCalls, 1);
      assert.equal(processControl.listenerCount("message"), 0);
      assert.equal(processControl.listenerCount("disconnect"), 0);
      assert.equal(processControl.listenerCount("SIGINT"), 0);
      assert.equal(processControl.listenerCount("SIGTERM"), 0);
    });
  }
});

test("treats disconnect and process signals as clean shutdown without taking Runtime ownership", async (t) => {
  for (const source of ["disconnect", "SIGINT", "SIGTERM"] as const) {
    await t.test(source, async () => {
      const processControl = new FakeProcessControl();
      const exits: number[] = [];
      const shutdownCalls: RuntimeConnectedWebHostShutdownOptions[] = [];
      const processRun = runRuntimeConnectedWebProcess({
        processControl,
        forceExit: (code) => exits.push(code),
        shutdownTimeoutMs: 987,
        startHost: async () => runningFixture(shutdownCalls),
      });
      processControl.emit("message", startMessage(RuntimeConnectedWebMode.development));
      await waitFor(() => processControl.sent.length === 1, `${source} ready IPC`);

      if (source === "disconnect") processControl.disconnectFromParent();
      else processControl.emit(source);
      await processRun;

      assert.deepEqual(shutdownCalls, [
        { reason: WebHostShutdownReason.requested, deadlineMs: 987 },
      ]);
      assert.equal(processControl.exitCode, 0);
      assert.deepEqual(exits, [0]);
      assert.equal(processControl.disconnectCalls, source === "disconnect" ? 0 : 1);
      assert.equal(processControl.sent.length, 1);
    });
  }
});

test("rejects an invalid first frame with a stable non-reflective failure", async () => {
  const processControl = new FakeProcessControl();
  const exits: number[] = [];
  let startCalls = 0;
  const processRun = runRuntimeConnectedWebProcess({
    processControl,
    forceExit: (code) => exits.push(code),
    startupTimeoutMs: 100,
    async startHost() {
      startCalls += 1;
      return runningFixture([]);
    },
  });
  processControl.emit("message", {
    ...startMessage(RuntimeConnectedWebMode.production),
    unexpected: `${ACCESS_TOKEN}-must-not-be-reflected`,
  });

  await assert.rejects(
    processRun,
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Runtime-connected Web process failed." &&
      !error.message.includes(ACCESS_TOKEN),
  );
  assert.equal(startCalls, 0);
  assert.deepEqual(processControl.sent, []);
  assert.equal(processControl.exitCode, 1);
  assert.deepEqual(exits, [1]);
  assert.equal(processControl.listenerCount("message"), 0);
});

test("treats a duplicate start frame as fatal and cleans the admitted Web owner", async () => {
  const processControl = new FakeProcessControl();
  const exits: number[] = [];
  const shutdownCalls: RuntimeConnectedWebHostShutdownOptions[] = [];
  const message = startMessage(RuntimeConnectedWebMode.production);
  const processRun = runRuntimeConnectedWebProcess({
    processControl,
    forceExit: (code) => exits.push(code),
    shutdownTimeoutMs: 654,
    startHost: async () => runningFixture(shutdownCalls),
  });
  processControl.emit("message", message);
  await waitFor(() => processControl.sent.length === 1, "ready IPC before duplicate start");
  processControl.emit("message", message);

  await assert.rejects(processRun, /Runtime-connected Web process failed/u);
  assert.deepEqual(shutdownCalls, [{ reason: WebHostShutdownReason.requested, deadlineMs: 654 }]);
  assert.equal(processControl.exitCode, 1);
  assert.deepEqual(exits, [1]);
  assert.equal(processControl.disconnectCalls, 1);
  assert.equal(JSON.stringify(processControl.sent).includes(ACCESS_TOKEN), false);
});

test("aborts interrupted startup, disposes the late Web owner, and never sends ready", async () => {
  const processControl = new FakeProcessControl();
  const exits: number[] = [];
  const shutdownCalls: RuntimeConnectedWebHostShutdownOptions[] = [];
  let startupSignal: AbortSignal | undefined;
  let resolveHost!: (running: RunningRuntimeConnectedWebHost) => void;
  const processRun = runRuntimeConnectedWebProcess({
    processControl,
    forceExit: (code) => exits.push(code),
    startupTimeoutMs: 100,
    startupCleanupTimeoutMs: 100,
    shutdownTimeoutMs: 321,
    startHost: (options) => {
      startupSignal = options.startupSignal;
      return new Promise((resolve) => {
        resolveHost = resolve;
      });
    },
  });
  processControl.emit("message", startMessage(RuntimeConnectedWebMode.development));
  await waitFor(() => startupSignal !== undefined, "pending Web startup");
  processControl.emit("message", createWorkbenchHostShutdownMessage());
  assert.equal(startupSignal?.aborted, true);
  resolveHost(runningFixture(shutdownCalls));

  await processRun;
  assert.deepEqual(shutdownCalls, [{ reason: WebHostShutdownReason.requested, deadlineMs: 321 }]);
  assert.deepEqual(processControl.sent, []);
  assert.equal(processControl.exitCode, 0);
  assert.deepEqual(exits, [0]);
  assert.equal(processControl.listenerCount("message"), 0);
  assert.equal(processControl.listenerCount("disconnect"), 0);
});
