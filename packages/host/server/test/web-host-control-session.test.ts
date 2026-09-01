import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { PassThrough, Readable, Writable } from "node:stream";
import test from "node:test";

import {
  WEB_HOST_CONTROL_MAX_FRAME_BYTES,
  WEB_HOST_CONTROL_VERSION,
  WebHostShutdownReason,
  WebHostStartupErrorCode,
  createWebHostShutdownFrame,
  createWebHostStartFrame,
  encodeWebHostControlInputFrame,
  parseWebHostControlOutputFrame,
} from "@workbench/host-contracts/web-host-control";

import {
  WebHostControlSessionResultCode,
  runWebHostControlSession,
  type RunningWebHostControlOwner,
} from "../src/web-host-control-session";

function nextOutput(stream: PassThrough): Promise<string> {
  return once(stream, "data").then(([chunk]) => String(chunk));
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test("runs one start/ready/shutdown/ack session against a real Web-only listener", async (t) => {
  const input = new PassThrough();
  const output = new PassThrough();
  let server: Server | undefined;
  const shutdowns: Array<{ reason: string; deadlineMs: number }> = [];
  const session = runWebHostControlSession({
    input,
    output,
    pid: 51_510,
    createInstanceId: () => "web-control-fixture",
    async startHost(options) {
      assert.equal(options.host, "127.0.0.1");
      assert.equal(options.port, 0);
      assert.equal(options.startupSignal instanceof AbortSignal, true);
      server = createServer((_request, response) => {
        response.statusCode = 204;
        response.end();
      });
      server.listen(options.port, options.host);
      await once(server, "listening");
      const port = (server.address() as AddressInfo).port;
      return {
        host: "127.0.0.1",
        port,
        httpOrigin: `http://127.0.0.1:${port}`,
        async shutdown(shutdown) {
          shutdowns.push(shutdown);
          await closeServer(server!);
        },
      };
    },
  });
  t.after(async () => {
    input.destroy();
    if (server) await closeServer(server).catch(() => undefined);
  });

  const readyOutput = nextOutput(output);
  input.write(
    encodeWebHostControlInputFrame(createWebHostStartFrame({ host: "127.0.0.1", port: 0 })),
  );
  const ready = parseWebHostControlOutputFrame(JSON.parse(await readyOutput));
  assert.equal(ready?.type, "ready");
  if (ready?.type !== "ready") assert.fail("expected ready");
  assert.equal(ready.pid, 51_510);
  assert.equal(ready.instanceId, "web-control-fixture");
  assert.equal((await fetch(ready.httpOrigin)).status, 204);

  const ackOutput = nextOutput(output);
  input.write(
    encodeWebHostControlInputFrame(
      createWebHostShutdownFrame({
        reason: WebHostShutdownReason.requested,
        deadlineMs: 4_321,
      }),
    ),
  );
  assert.equal(parseWebHostControlOutputFrame(JSON.parse(await ackOutput))?.type, "shutdown-ack");
  assert.deepEqual(await session, {
    code: WebHostControlSessionResultCode.shutdownAcknowledged,
  });
  assert.deepEqual(shutdowns, [{ reason: WebHostShutdownReason.requested, deadlineMs: 4_321 }]);
  assert.equal(server?.listening, false);
});

test("rejects protocol mismatches and strict extra fields before startup", async (t) => {
  const cases = [
    {
      name: "version mismatch",
      frame: {
        type: "start",
        controlVersion: WEB_HOST_CONTROL_VERSION + 1,
        host: "127.0.0.1",
        port: 0,
      },
      code: WebHostStartupErrorCode.unsupportedControlVersion,
    },
    {
      name: "extra start field",
      frame: {
        type: "start",
        controlVersion: WEB_HOST_CONTROL_VERSION,
        host: "127.0.0.1",
        port: 0,
        webRoot: "/credential-like/source/path",
      },
      code: WebHostStartupErrorCode.invalidControlFrame,
    },
  ] as const;

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const output = new PassThrough();
      const chunks: string[] = [];
      output.on("data", (chunk) => chunks.push(String(chunk)));
      let starts = 0;
      const result = await runWebHostControlSession({
        input: Readable.from([Buffer.from(`${JSON.stringify(fixture.frame)}\n`)]),
        output,
        pid: 61_610,
        startHost() {
          starts += 1;
          throw new Error("must not start");
        },
      });
      assert.equal(result.code, WebHostControlSessionResultCode.invalidControl);
      assert.equal(starts, 0);
      const parsed = parseWebHostControlOutputFrame(JSON.parse(chunks.join("")));
      assert.equal(parsed?.type, "startup-error");
      if (parsed?.type === "startup-error") assert.equal(parsed.code, fixture.code);
      assert.equal(chunks.join("").includes("/credential-like"), false);
    });
  }
});

test("emits one stable startup error when the injected Web owner fails", async () => {
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(String(chunk)));
  const result = await runWebHostControlSession({
    input: Readable.from([
      Buffer.from(
        encodeWebHostControlInputFrame(
          createWebHostStartFrame({ host: "127.0.0.1", port: 43_127 }),
        ),
      ),
    ]),
    output,
    pid: 71_710,
    startHost() {
      throw new Error("/private/artifact/diagnostic");
    },
  });
  assert.equal(result.code, WebHostControlSessionResultCode.startupFailed);
  assert.equal(chunks.length, 1);
  const frame = parseWebHostControlOutputFrame(JSON.parse(chunks[0]!));
  assert.equal(frame?.type, "startup-error");
  if (frame?.type === "startup-error") {
    assert.equal(frame.code, WebHostStartupErrorCode.startupFailed);
  }
  assert.equal(chunks.join("").includes("/private/artifact"), false);
});

function fakeRunningHost(
  shutdowns: Array<{ reason: string; deadlineMs: number }>,
  shutdown: (options: { reason: string; deadlineMs: number }) => Promise<void> = async () => {},
): RunningWebHostControlOwner {
  return {
    host: "127.0.0.1",
    port: 43_127,
    httpOrigin: "http://127.0.0.1:43127",
    async shutdown(options) {
      shutdowns.push(options);
      await shutdown(options);
    },
  };
}

test("treats control EOF after ready as parent exit and cleans up without ack", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(String(chunk)));
  const shutdowns: Array<{ reason: string; deadlineMs: number }> = [];
  const session = runWebHostControlSession({
    input,
    output,
    pid: 81_810,
    createInstanceId: () => "disconnect-fixture",
    disconnectedShutdownDeadlineMs: 987,
    startHost: () => fakeRunningHost(shutdowns),
  });
  input.write(
    encodeWebHostControlInputFrame(createWebHostStartFrame({ host: "127.0.0.1", port: 0 })),
  );
  await once(output, "data");
  input.end();
  const result = await session;
  assert.equal(result.code, WebHostControlSessionResultCode.controlDisconnected);
  assert.deepEqual(shutdowns, [{ reason: WebHostShutdownReason.containerExit, deadlineMs: 987 }]);
  assert.deepEqual(
    chunks.map((chunk) => parseWebHostControlOutputFrame(JSON.parse(chunk))?.type),
    ["ready"],
  );
});

test("aborts pending startup on control EOF and disposes a late owner without ready", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(String(chunk)));
  const shutdowns: Array<{ reason: string; deadlineMs: number }> = [];
  let resolveStartupSignal!: (signal: AbortSignal) => void;
  const startupSignalReady = new Promise<AbortSignal>((resolve) => {
    resolveStartupSignal = resolve;
  });
  let resolveStart!: (owner: RunningWebHostControlOwner) => void;
  const session = runWebHostControlSession({
    input,
    output,
    pid: 82_820,
    disconnectedShutdownDeadlineMs: 654,
    startHost(options) {
      resolveStartupSignal(options.startupSignal);
      return new Promise((resolve) => {
        resolveStart = resolve;
      });
    },
  });
  input.write(
    encodeWebHostControlInputFrame(createWebHostStartFrame({ host: "127.0.0.1", port: 0 })),
  );
  const startupSignal = await startupSignalReady;
  input.end();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(startupSignal.aborted, true);
  resolveStart(fakeRunningHost(shutdowns));
  assert.deepEqual(await session, {
    code: WebHostControlSessionResultCode.controlDisconnected,
  });
  assert.deepEqual(shutdowns, [{ reason: WebHostShutdownReason.containerExit, deadlineMs: 654 }]);
  assert.deepEqual(chunks, []);
});

test("aborts pending startup on lifecycle signal and disposes a late owner without ready", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const lifecycle = new AbortController();
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(String(chunk)));
  const shutdowns: Array<{ reason: string; deadlineMs: number }> = [];
  let resolveStartupSignal!: (signal: AbortSignal) => void;
  const startupSignalReady = new Promise<AbortSignal>((resolve) => {
    resolveStartupSignal = resolve;
  });
  let resolveStart!: (owner: RunningWebHostControlOwner) => void;
  const session = runWebHostControlSession({
    input,
    output,
    pid: 83_830,
    lifecycleController: lifecycle,
    startHost(options) {
      resolveStartupSignal(options.startupSignal);
      return new Promise((resolve) => {
        resolveStart = resolve;
      });
    },
  });
  input.write(
    encodeWebHostControlInputFrame(createWebHostStartFrame({ host: "127.0.0.1", port: 0 })),
  );
  const startupSignal = await startupSignalReady;
  lifecycle.abort();
  assert.equal(startupSignal.aborted, true);
  resolveStart(fakeRunningHost(shutdowns));
  assert.deepEqual(await session, {
    code: WebHostControlSessionResultCode.controlDisconnected,
  });
  assert.deepEqual(shutdowns, [{ reason: WebHostShutdownReason.containerExit, deadlineMs: 5_000 }]);
  assert.deepEqual(chunks, []);
});

test("aborts pending startup on malformed control and disposes a late owner without ready", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(String(chunk)));
  const shutdowns: Array<{ reason: string; deadlineMs: number }> = [];
  let resolveStartupSignal!: (signal: AbortSignal) => void;
  const startupSignalReady = new Promise<AbortSignal>((resolve) => {
    resolveStartupSignal = resolve;
  });
  let resolveStart!: (owner: RunningWebHostControlOwner) => void;
  const session = runWebHostControlSession({
    input,
    output,
    pid: 84_840,
    startHost(options) {
      resolveStartupSignal(options.startupSignal);
      return new Promise((resolve) => {
        resolveStart = resolve;
      });
    },
  });
  input.write(
    encodeWebHostControlInputFrame(createWebHostStartFrame({ host: "127.0.0.1", port: 0 })),
  );
  const startupSignal = await startupSignalReady;
  input.write('{"type":\n');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(startupSignal.aborted, true);
  resolveStart(fakeRunningHost(shutdowns));
  assert.deepEqual(await session, {
    code: WebHostControlSessionResultCode.invalidControl,
  });
  assert.deepEqual(shutdowns, [{ reason: WebHostShutdownReason.containerExit, deadlineMs: 5_000 }]);
  assert.deepEqual(
    chunks.map((chunk) => parseWebHostControlOutputFrame(JSON.parse(chunk))?.type),
    ["startup-error"],
  );
});

test("acknowledges shutdown during pending startup only after disposing the late owner", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(String(chunk)));
  const shutdowns: Array<{ reason: string; deadlineMs: number }> = [];
  let resolveStart!: (owner: RunningWebHostControlOwner) => void;
  let startupSignal!: AbortSignal;
  const session = runWebHostControlSession({
    input,
    output,
    pid: 85_850,
    startHost(options) {
      startupSignal = options.startupSignal;
      return new Promise((resolve) => {
        resolveStart = resolve;
      });
    },
  });
  input.write(
    encodeWebHostControlInputFrame(createWebHostStartFrame({ host: "127.0.0.1", port: 0 })),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  input.write(
    encodeWebHostControlInputFrame(
      createWebHostShutdownFrame({
        reason: WebHostShutdownReason.restart,
        deadlineMs: 777,
      }),
    ),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(startupSignal.aborted, true);
  assert.deepEqual(chunks, []);
  resolveStart(fakeRunningHost(shutdowns));
  assert.deepEqual(await session, {
    code: WebHostControlSessionResultCode.shutdownAcknowledged,
  });
  assert.deepEqual(shutdowns, [{ reason: WebHostShutdownReason.restart, deadlineMs: 777 }]);
  assert.deepEqual(
    chunks.map((chunk) => parseWebHostControlOutputFrame(JSON.parse(chunk))?.type),
    ["shutdown-ack"],
  );
});

test("bounds a non-cooperative pending start and still disposes a later owner once", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(String(chunk)));
  const shutdowns: Array<{ reason: string; deadlineMs: number }> = [];
  let resolveStart!: (owner: RunningWebHostControlOwner) => void;
  const session = runWebHostControlSession({
    input,
    output,
    pid: 86_860,
    disconnectedShutdownDeadlineMs: 20,
    startHost() {
      return new Promise((resolve) => {
        resolveStart = resolve;
      });
    },
  });
  input.write(
    encodeWebHostControlInputFrame(createWebHostStartFrame({ host: "127.0.0.1", port: 0 })),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  input.end();
  assert.deepEqual(await session, { code: WebHostControlSessionResultCode.shutdownFailed });
  assert.deepEqual(chunks, []);

  resolveStart(fakeRunningHost(shutdowns));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(shutdowns, [{ reason: WebHostShutdownReason.containerExit, deadlineMs: 20 }]);
});

test("rejects duplicate start, disposes the owner, and never acknowledges", async () => {
  const start = encodeWebHostControlInputFrame(
    createWebHostStartFrame({ host: "127.0.0.1", port: 0 }),
  );
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(String(chunk)));
  const shutdowns: Array<{ reason: string; deadlineMs: number }> = [];
  let starts = 0;
  const session = runWebHostControlSession({
    input,
    output,
    pid: 91_910,
    createInstanceId: () => "duplicate-fixture",
    startHost() {
      starts += 1;
      return fakeRunningHost(shutdowns);
    },
  });
  input.write(start);
  await once(output, "data");
  input.write(start);
  const result = await session;
  assert.equal(result.code, WebHostControlSessionResultCode.invalidControl);
  assert.equal(starts, 1);
  assert.equal(shutdowns[0]?.reason, WebHostShutdownReason.containerExit);
  assert.deepEqual(
    chunks.map((chunk) => parseWebHostControlOutputFrame(JSON.parse(chunk))?.type),
    ["ready"],
  );
});

test("rejects oversized/incomplete control and cleans a started owner", async () => {
  const outputBeforeStart = new PassThrough();
  const beforeChunks: string[] = [];
  outputBeforeStart.on("data", (chunk) => beforeChunks.push(String(chunk)));
  const oversized = await runWebHostControlSession({
    input: Readable.from([Buffer.alloc(WEB_HOST_CONTROL_MAX_FRAME_BYTES + 1, 0x61)]),
    output: outputBeforeStart,
    pid: 10_101,
    startHost: () => assert.fail("must not start"),
  });
  assert.equal(oversized.code, WebHostControlSessionResultCode.invalidControl);
  assert.equal(
    parseWebHostControlOutputFrame(JSON.parse(beforeChunks.join("")))?.type,
    "startup-error",
  );

  const shutdowns: Array<{ reason: string; deadlineMs: number }> = [];
  const outputAfterStart = new PassThrough();
  const afterChunks: string[] = [];
  outputAfterStart.on("data", (chunk) => afterChunks.push(String(chunk)));
  const start = encodeWebHostControlInputFrame(
    createWebHostStartFrame({ host: "127.0.0.1", port: 0 }),
  );
  const incomplete = await runWebHostControlSession({
    input: Readable.from([Buffer.from(`${start}{"type":`)]),
    output: outputAfterStart,
    pid: 10_102,
    createInstanceId: () => "incomplete-fixture",
    startHost: () => fakeRunningHost(shutdowns),
  });
  assert.equal(incomplete.code, WebHostControlSessionResultCode.invalidControl);
  assert.equal(shutdowns[0]?.reason, WebHostShutdownReason.containerExit);
  assert.deepEqual(
    afterChunks.map((chunk) => parseWebHostControlOutputFrame(JSON.parse(chunk))?.type),
    ["ready"],
  );
});

test("withholds acknowledgement when shutdown fails or has not completed", async (t) => {
  await t.test("failure", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk) => chunks.push(String(chunk)));
    const shutdowns: Array<{ reason: string; deadlineMs: number }> = [];
    const session = runWebHostControlSession({
      input,
      output,
      pid: 11_110,
      createInstanceId: () => "shutdown-failure-fixture",
      startHost: () =>
        fakeRunningHost(shutdowns, async () => {
          throw new Error("shutdown failed");
        }),
    });
    input.write(
      encodeWebHostControlInputFrame(createWebHostStartFrame({ host: "127.0.0.1", port: 0 })),
    );
    await once(output, "data");
    input.write(
      encodeWebHostControlInputFrame(
        createWebHostShutdownFrame({
          reason: WebHostShutdownReason.requested,
          deadlineMs: 1_000,
        }),
      ),
    );
    const result = await session;
    assert.equal(result.code, WebHostControlSessionResultCode.shutdownFailed);
    assert.deepEqual(
      chunks.map((chunk) => parseWebHostControlOutputFrame(JSON.parse(chunk))?.type),
      ["ready"],
    );
  });

  await t.test("pending", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk) => chunks.push(String(chunk)));
    let releaseShutdown!: () => void;
    const shutdownGate = new Promise<void>((resolve) => (releaseShutdown = resolve));
    const session = runWebHostControlSession({
      input,
      output,
      pid: 11_111,
      createInstanceId: () => "shutdown-pending-fixture",
      startHost: () => fakeRunningHost([], () => shutdownGate),
    });
    input.write(
      encodeWebHostControlInputFrame(createWebHostStartFrame({ host: "127.0.0.1", port: 0 })),
    );
    await once(output, "data");
    input.write(
      encodeWebHostControlInputFrame(
        createWebHostShutdownFrame({
          reason: WebHostShutdownReason.requested,
          deadlineMs: 1_000,
        }),
      ),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(chunks.length, 1);
    releaseShutdown();
    await once(output, "data");
    assert.equal(chunks.length, 2);
    assert.equal((await session).code, WebHostControlSessionResultCode.shutdownAcknowledged);
  });
});

test("cleans the owner when the ready writer or input iterator fails", async (t) => {
  await t.test("ready writer", async () => {
    const shutdowns: Array<{ reason: string; deadlineMs: number }> = [];
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error("stdout failed"));
      },
    });
    output.on("error", () => undefined);
    await assert.rejects(
      runWebHostControlSession({
        input: Readable.from([
          Buffer.from(
            encodeWebHostControlInputFrame(createWebHostStartFrame({ host: "127.0.0.1", port: 0 })),
          ),
        ]),
        output,
        pid: 12_120,
        createInstanceId: () => "writer-failure-fixture",
        startHost: () => fakeRunningHost(shutdowns),
      }),
      /Web Host control session failed/u,
    );
    assert.equal(shutdowns[0]?.reason, WebHostShutdownReason.containerExit);
  });

  await t.test("input iterator", async () => {
    const shutdowns: Array<{ reason: string; deadlineMs: number }> = [];
    async function* failingInput(): AsyncIterable<Uint8Array> {
      yield Buffer.from(
        encodeWebHostControlInputFrame(createWebHostStartFrame({ host: "127.0.0.1", port: 0 })),
      );
      throw new Error("/private/input/diagnostic");
    }
    await assert.rejects(
      runWebHostControlSession({
        input: failingInput(),
        output: new PassThrough(),
        pid: 12_121,
        createInstanceId: () => "iterator-failure-fixture",
        startHost: () => fakeRunningHost(shutdowns),
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "Web Host control session failed." &&
        !error.message.includes("/private/input"),
    );
    assert.equal(shutdowns[0]?.reason, WebHostShutdownReason.containerExit);
  });
});
