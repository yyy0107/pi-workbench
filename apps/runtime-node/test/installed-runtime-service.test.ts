import assert from "node:assert/strict";
import test from "node:test";

import { createInstalledRuntimeDisposer } from "../src/installed-runtime-service";

test("installed Runtime disposal waits for Pi quiescence before disposing Terminal owners", async () => {
  const calls: string[] = [];
  let releasePi!: () => void;
  const piReleased = new Promise<void>((resolve) => (releasePi = resolve));
  let reenteredDispose: Promise<void> | undefined;
  let dispose!: () => Promise<void>;
  dispose = createInstalledRuntimeDisposer({
    async disposePi() {
      calls.push("pi:start");
      reenteredDispose = dispose();
      await piReleased;
      calls.push("pi:end");
    },
    disposeTerminals: [() => calls.push("terminal:interactive"), () => calls.push("terminal:tool")],
  });

  const operation = dispose();
  assert.equal(dispose(), operation);
  assert.equal(reenteredDispose, operation);
  assert.deepEqual(calls, ["pi:start"]);
  releasePi();
  await operation;
  assert.deepEqual(calls, ["pi:start", "pi:end", "terminal:interactive", "terminal:tool"]);
});

test("installed Runtime disposal attempts every Terminal owner after a Pi failure", async () => {
  const piFailure = new Error("Pi shutdown failed");
  const terminalFailure = new Error("interactive terminal shutdown failed");
  const calls: string[] = [];
  const dispose = createInstalledRuntimeDisposer({
    async disposePi() {
      throw piFailure;
    },
    disposeTerminals: [
      () => {
        calls.push("terminal:interactive");
        throw terminalFailure;
      },
      () => calls.push("terminal:tool"),
    ],
  });

  await assert.rejects(dispose(), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [piFailure, terminalFailure]);
    return true;
  });
  assert.deepEqual(calls, ["terminal:interactive", "terminal:tool"]);
});

test("an aborted shutdown deadline force-disposes Terminal owners without waiting for Pi", async () => {
  const calls: string[] = [];
  let releasePi!: () => void;
  const piReleased = new Promise<void>((resolve) => (releasePi = resolve));
  const controller = new AbortController();
  const dispose = createInstalledRuntimeDisposer({
    async disposePi() {
      calls.push("pi:start");
      await piReleased;
      calls.push("pi:end");
    },
    disposeTerminals: [() => calls.push("terminal:interactive"), () => calls.push("terminal:tool")],
  });

  const operation = dispose(controller.signal);
  assert.deepEqual(calls, ["pi:start"]);
  controller.abort(new Error("shutdown deadline expired"));
  assert.deepEqual(calls, ["pi:start", "terminal:interactive", "terminal:tool"]);

  let settled = false;
  void operation.finally(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);

  releasePi();
  await operation;
  assert.deepEqual(calls, ["pi:start", "terminal:interactive", "terminal:tool", "pi:end"]);
});
