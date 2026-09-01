import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { WebHostControlSessionResultCode } from "@workbench/host-server/web-host-control-session";

import { runWebHostProcess } from "@/server/web-host-process";

test("loads the artifact layout only after a valid control start and fixes Next to production", async () => {
  const calls: string[] = [];
  const exitCodes: number[] = [];
  await runWebHostProcess({
    artifactRoot: "/artifact",
    input: new PassThrough(),
    output: new PassThrough(),
    pid: 41_410,
    setExitCode: (code) => exitCodes.push(code),
    forceExit: () => assert.fail("successful control must not force exit"),
    async loadLayout(root) {
      calls.push(`layout:${root}`);
      return {
        artifactRoot: root,
        webRoot: "/artifact/apps/web",
        manifest: {} as never,
      };
    },
    async startHost(options, dependencies) {
      calls.push(`web:${options.hostname}:${options.port}:${options.webRoot}`);
      assert.equal(options.dev, false);
      assert.equal(options.startupSignal instanceof AbortSignal, true);
      assert.equal(dependencies, undefined);
      return {
        host: "127.0.0.1",
        port: 43_127,
        httpOrigin: "http://127.0.0.1:43127",
        shutdown: async () => undefined,
      };
    },
    async runControlSession(options) {
      calls.push("control:start");
      assert.deepEqual(calls, ["control:start"], "layout must remain lazy before start");
      assert.equal(options.pid, 41_410);
      assert.equal(options.lifecycleController instanceof AbortController, true);
      await options.startHost({
        host: "127.0.0.1",
        port: 0,
        startupSignal: options.lifecycleController!.signal,
      });
      return { code: WebHostControlSessionResultCode.shutdownAcknowledged };
    },
  });
  assert.deepEqual(calls, [
    "control:start",
    "layout:/artifact",
    "web:127.0.0.1:0:/artifact/apps/web",
  ]);
  assert.deepEqual(exitCodes, [0]);
});

test("passes one injected lifecycle controller to the control session", async () => {
  const lifecycle = new AbortController();
  await runWebHostProcess({
    artifactRoot: "/artifact",
    lifecycleController: lifecycle,
    forceExit: () => assert.fail("successful control must not force exit"),
    async runControlSession(options) {
      assert.equal(options.lifecycleController, lifecycle);
      return { code: WebHostControlSessionResultCode.controlDisconnected };
    },
  });
});

test("forwards an injected lifecycle signal into the one process controller", async () => {
  const lifecycleController = new AbortController();
  const injectedLifecycle = new AbortController();
  let sessionReady!: () => void;
  const ready = new Promise<void>((resolve) => (sessionReady = resolve));
  const running = runWebHostProcess({
    artifactRoot: "/artifact",
    lifecycleController,
    lifecycleSignal: injectedLifecycle.signal,
    forceExit: () => assert.fail("a forwarded disconnect must not force exit"),
    async runControlSession(options) {
      assert.equal(options.lifecycleController, lifecycleController);
      sessionReady();
      await new Promise<void>((resolve) =>
        lifecycleController.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      return { code: WebHostControlSessionResultCode.controlDisconnected };
    },
  });
  await ready;
  injectedLifecycle.abort();
  await running;
  assert.equal(lifecycleController.signal.aborted, true);
});

test("maps SIGINT and SIGTERM to the shared controller, bounded cleanup, and exit zero", async (t) => {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    await t.test(signal, async () => {
      const processControl = new EventEmitter();
      const exitCodes: number[] = [];
      const exits: number[] = [];
      let sessionReady!: () => void;
      const ready = new Promise<void>((resolve) => (sessionReady = resolve));
      const running = runWebHostProcess({
        artifactRoot: "/artifact",
        input: new PassThrough(),
        output: new PassThrough(),
        processControl,
        setExitCode: (code) => exitCodes.push(code),
        forceExit: (code) => exits.push(code),
        async runControlSession(options) {
          const controller = options.lifecycleController!;
          sessionReady();
          await new Promise<void>((resolve) =>
            controller.signal.addEventListener("abort", () => resolve(), { once: true }),
          );
          return { code: WebHostControlSessionResultCode.controlDisconnected };
        },
      });
      await ready;
      processControl.emit(signal);
      await running;

      assert.deepEqual(exitCodes, [0]);
      assert.deepEqual(exits, [0]);
      assert.equal(processControl.listenerCount("SIGINT"), 0);
      assert.equal(processControl.listenerCount("SIGTERM"), 0);
    });
  }
});

test("maps invalid control and thrown session failures to stable process failure", async (t) => {
  await t.test("invalid result", async () => {
    const exits: number[] = [];
    const exitCodes: number[] = [];
    await runWebHostProcess({
      artifactRoot: "/artifact",
      setExitCode: (code) => exitCodes.push(code),
      forceExit: (code) => exits.push(code),
      async runControlSession() {
        return { code: WebHostControlSessionResultCode.invalidControl };
      },
    });
    assert.deepEqual(exitCodes, [1]);
    assert.deepEqual(exits, [1]);
  });

  await t.test("throw", async () => {
    const failure = new Error("fixed injected failure");
    const exits: number[] = [];
    const exitCodes: number[] = [];
    await assert.rejects(
      runWebHostProcess({
        artifactRoot: "/artifact",
        setExitCode: (code) => exitCodes.push(code),
        forceExit: (code) => exits.push(code),
        async runControlSession() {
          throw failure;
        },
      }),
      (error: unknown) => error === failure,
    );
    assert.deepEqual(exitCodes, [1]);
    assert.deepEqual(exits, [1]);
  });
});
