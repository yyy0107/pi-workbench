import assert from "node:assert/strict";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";

import { RuntimeHostControlSessionResultCode } from "@workbench/host-server/runtime-host-control-session";

import {
  disposeInstalledRuntimeLifecycleWithinDeadline,
  runInstalledRuntimeHostControl,
} from "../src/installed-api-only-runtime-host";

test("startup cleanup aborts and returns at its deadline when installed disposal never settles", async () => {
  let cleanupSignal: AbortSignal | undefined;
  const startedAt = Date.now();
  await disposeInstalledRuntimeLifecycleWithinDeadline({
    deadlineMs: 20,
    reason: "startup-failed",
    lifecycle: {
      dispose({ signal }) {
        cleanupSignal = signal;
        return new Promise<void>(() => undefined);
      },
    },
  });

  assert.ok(cleanupSignal);
  assert.equal(cleanupSignal.aborted, true);
  assert.ok(Date.now() - startedAt < 1_000);
});

test("runtime-only control force-exits after a bounded shutdown failure", async () => {
  const exitCodes: number[] = [];
  const previousExitCode = process.exitCode;
  try {
    await runInstalledRuntimeHostControl({
      input: Readable.from([]),
      output: new PassThrough(),
      forceExit: (code) => exitCodes.push(code),
      runControlSession: async () => ({
        code: RuntimeHostControlSessionResultCode.shutdownFailed,
      }),
    });
    assert.deepEqual(exitCodes, [1]);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("runtime-only control force-exits when control-error cleanup throws", async () => {
  const exitCodes: number[] = [];
  const failure = new Error("control cleanup failed");
  const previousExitCode = process.exitCode;
  try {
    await assert.rejects(
      runInstalledRuntimeHostControl({
        input: Readable.from([]),
        output: new PassThrough(),
        forceExit: (code) => exitCodes.push(code),
        runControlSession: async () => {
          throw failure;
        },
      }),
      (error: unknown) => error === failure,
    );
    assert.deepEqual(exitCodes, [1]);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("runtime-only control does not force-exit after complete disposal", async () => {
  const exitCodes: number[] = [];
  const previousExitCode = process.exitCode;
  try {
    await runInstalledRuntimeHostControl({
      input: Readable.from([]),
      output: new PassThrough(),
      forceExit: (code) => exitCodes.push(code),
      runControlSession: async () => ({
        code: RuntimeHostControlSessionResultCode.shutdownAcknowledged,
      }),
    });
    assert.deepEqual(exitCodes, []);
    assert.equal(process.exitCode, 0);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("runtime-only control force-exits for every non-success result", async () => {
  const exitCodes: number[] = [];
  const previousExitCode = process.exitCode;
  try {
    await runInstalledRuntimeHostControl({
      input: Readable.from([]),
      output: new PassThrough(),
      forceExit: (code) => exitCodes.push(code),
      runControlSession: async () => ({
        code: RuntimeHostControlSessionResultCode.invalidControl,
      }),
    });
    assert.deepEqual(exitCodes, [1]);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("managed Runtime children defer terminal signals to supervisor control and remove the leash", async () => {
  const exitCodes: number[] = [];
  const before = new Set(process.listeners("SIGTERM"));
  await runInstalledRuntimeHostControl({
    input: Readable.from([]),
    output: new PassThrough(),
    managedChild: true,
    forceExit: (code) => exitCodes.push(code),
    runControlSession: async () => {
      const added = process.listeners("SIGTERM").filter((listener) => !before.has(listener));
      assert.equal(added.length, 1);
      (added[0] as () => void)();
      return { code: RuntimeHostControlSessionResultCode.shutdownAcknowledged };
    },
  });
  assert.deepEqual(exitCodes, []);
  assert.deepEqual(
    process.listeners("SIGTERM").filter((listener) => !before.has(listener)),
    [],
  );
});
