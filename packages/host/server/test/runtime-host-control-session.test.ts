import assert from "node:assert/strict";
import { once } from "node:events";
import { PassThrough, Readable, Writable } from "node:stream";
import test from "node:test";

import {
  RUNTIME_HOST_CONTROL_MAX_FRAME_BYTES,
  RUNTIME_HOST_CONTROL_VERSION,
  RuntimeHostShutdownReason,
  RuntimeHostStartupErrorCode,
  createRuntimeHostIdentity,
  createRuntimeHostShutdownFrame,
  createRuntimeHostStartFrame,
  encodeRuntimeHostControlInputFrame,
  parseRuntimeHostControlOutputFrame,
} from "@workbench/host-contracts/runtime-host-control";

import {
  RuntimeHostLifecycleReason,
  startApiOnlyRuntimeHost,
  type RunningApiOnlyRuntimeHost,
} from "../src/api-only-runtime-host";
import {
  RuntimeHostControlSessionResultCode,
  runRuntimeHostControlSession,
} from "../src/runtime-host-control-session";

const ACCESS_TOKEN = "stdin-only-control-secret";
const RENDERER_ORIGIN = "https://renderer.workbench.test";

function nextOutput(stream: PassThrough): Promise<string> {
  return once(stream, "data").then(([chunk]) => String(chunk));
}

test("runs start/ready/shutdown/ack against a real non-Pi API-only listener without leaking the token", async (t) => {
  const input = new PassThrough();
  const output = new PassThrough();
  const outputChunks: string[] = [];
  output.on("data", (chunk) => outputChunks.push(String(chunk)));
  let releaseDispose!: () => void;
  const disposal = new Promise<void>((resolve) => (releaseDispose = resolve));
  let running: RunningApiOnlyRuntimeHost | undefined;
  const session = runRuntimeHostControlSession({
    input,
    output,
    createInstanceId: () => "control-fixture",
    async startHost(options) {
      running = await startApiOnlyRuntimeHost({
        ...options,
        pid: 5151,
        runtimeApi: () => Response.json({ fixture: true }),
        webSocketGateway: { handleUpgrade: () => false },
        upgradeRequiredPaths: [],
        lifecycle: { dispose: () => disposal },
      });
      return running;
    },
  });
  t.after(async () => {
    releaseDispose();
    input.destroy();
    await running
      ?.shutdown({ reason: RuntimeHostLifecycleReason.requested, deadlineMs: 5_000 })
      .catch(() => undefined);
  });

  const readyOutput = nextOutput(output);
  input.write(
    encodeRuntimeHostControlInputFrame(
      createRuntimeHostStartFrame({
        accessToken: ACCESS_TOKEN,
        allowedOrigins: [RENDERER_ORIGIN],
      }),
    ),
  );
  const readyText = await readyOutput;
  const ready = parseRuntimeHostControlOutputFrame(JSON.parse(readyText));
  assert.equal(ready?.type, "ready");
  assert.equal(readyText.includes(ACCESS_TOKEN), false);
  assert.equal(running?.server.listening, true);

  const health = await fetch(`${running!.httpOrigin}/api/health`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  assert.equal(health.status, 200);

  const ackOutput = nextOutput(output);
  input.write(
    encodeRuntimeHostControlInputFrame(
      createRuntimeHostShutdownFrame({
        reason: RuntimeHostShutdownReason.requested,
        deadlineMs: 5_000,
      }),
    ),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(outputChunks.length, 1, "ack must wait for injected graph disposal");
  releaseDispose();
  const ackText = await ackOutput;
  assert.equal(parseRuntimeHostControlOutputFrame(JSON.parse(ackText))?.type, "shutdown-ack");
  assert.equal(outputChunks.join("").includes(ACCESS_TOKEN), false);
  assert.deepEqual(await session, {
    code: RuntimeHostControlSessionResultCode.shutdownAcknowledged,
  });
  assert.equal(running?.server.listening, false);
});

test("withholds shutdown acknowledgement when the real Host lifecycle exceeds its total deadline", async () => {
  const output = new PassThrough();
  const outputChunks: string[] = [];
  output.on("data", (chunk) => outputChunks.push(String(chunk)));
  let disposalSignal: AbortSignal | undefined;
  const start = encodeRuntimeHostControlInputFrame(
    createRuntimeHostStartFrame({
      accessToken: ACCESS_TOKEN,
      allowedOrigins: [RENDERER_ORIGIN],
    }),
  );
  const shutdown = encodeRuntimeHostControlInputFrame(
    createRuntimeHostShutdownFrame({
      reason: RuntimeHostShutdownReason.requested,
      deadlineMs: 20,
    }),
  );

  const result = await runRuntimeHostControlSession({
    input: Readable.from([Buffer.from(`${start}${shutdown}`)]),
    output,
    createInstanceId: () => "deadline-fixture",
    startHost: (options) =>
      startApiOnlyRuntimeHost({
        ...options,
        pid: 5252,
        runtimeApi: () => new Response(null, { status: 204 }),
        webSocketGateway: { handleUpgrade: () => false },
        upgradeRequiredPaths: [],
        lifecycle: {
          dispose({ signal }) {
            disposalSignal = signal;
            return new Promise<void>(() => undefined);
          },
        },
      }),
  });

  assert.deepEqual(result, { code: RuntimeHostControlSessionResultCode.shutdownFailed });
  assert.ok(disposalSignal);
  assert.equal(disposalSignal.aborted, true);
  assert.deepEqual(
    outputChunks.map((chunk) => parseRuntimeHostControlOutputFrame(JSON.parse(chunk))?.type),
    ["ready"],
  );
  assert.equal(outputChunks.join("").includes(ACCESS_TOKEN), false);
});

test("reports an unsupported version with a fixed credential-free startup error", async () => {
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(String(chunk)));
  let starts = 0;
  const result = await runRuntimeHostControlSession({
    input: Readable.from([
      Buffer.from(
        `${JSON.stringify({
          type: "start",
          controlVersion: RUNTIME_HOST_CONTROL_VERSION + 1,
          authMode: "desktop-sidecar",
          accessToken: ACCESS_TOKEN,
          allowedOrigins: [RENDERER_ORIGIN],
        })}\n`,
      ),
    ]),
    output,
    startHost() {
      starts += 1;
      throw new Error("must not start");
    },
  });
  assert.deepEqual(result, { code: RuntimeHostControlSessionResultCode.invalidControl });
  assert.equal(starts, 0);
  assert.equal(chunks.join("").includes(ACCESS_TOKEN), false);
  const frame = parseRuntimeHostControlOutputFrame(JSON.parse(chunks.join("")));
  assert.equal(frame?.type, "startup-error");
  if (frame?.type === "startup-error") {
    assert.equal(frame.code, RuntimeHostStartupErrorCode.unsupportedControlVersion);
  }
});

test("never accepts a generated instance identity equal to the start credential", async () => {
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(String(chunk)));
  let starts = 0;
  const result = await runRuntimeHostControlSession({
    input: Readable.from([
      Buffer.from(
        encodeRuntimeHostControlInputFrame(
          createRuntimeHostStartFrame({
            accessToken: ACCESS_TOKEN,
            allowedOrigins: [RENDERER_ORIGIN],
          }),
        ),
      ),
    ]),
    output,
    createInstanceId: () => ACCESS_TOKEN,
    startHost() {
      starts += 1;
      throw new Error("must not start");
    },
  });
  assert.equal(result.code, RuntimeHostControlSessionResultCode.startupFailed);
  assert.equal(starts, 0);
  assert.equal(chunks.join("").includes(ACCESS_TOKEN), false);
  assert.equal(
    parseRuntimeHostControlOutputFrame(JSON.parse(chunks.join("")))?.type,
    "startup-error",
  );
});

test("rejects oversized NDJSON before startup with one fixed error frame", async () => {
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(String(chunk)));
  const result = await runRuntimeHostControlSession({
    input: Readable.from([Buffer.alloc(RUNTIME_HOST_CONTROL_MAX_FRAME_BYTES + 1, 0x61)]),
    output,
    startHost: () => {
      throw new Error("must not start");
    },
  });
  assert.equal(result.code, RuntimeHostControlSessionResultCode.invalidControl);
  const frame = parseRuntimeHostControlOutputFrame(JSON.parse(chunks.join("")));
  assert.equal(frame?.type, "startup-error");
  if (frame?.type === "startup-error") {
    assert.equal(frame.code, RuntimeHostStartupErrorCode.invalidControlFrame);
  }
});

function fakeRunningHost(shutdownReasons: RuntimeHostLifecycleReason[]): RunningApiOnlyRuntimeHost {
  return {
    server: { listening: true } as RunningApiOnlyRuntimeHost["server"],
    host: "127.0.0.1",
    port: 43127,
    httpOrigin: "http://127.0.0.1:43127",
    identity: createRuntimeHostIdentity({ instanceId: "state-fixture", pid: 6161 }),
    async shutdown({ reason }) {
      shutdownReasons.push(reason);
    },
  };
}

test("rejects a duplicate start and disposes the one running Host without an acknowledgement", async () => {
  const start = encodeRuntimeHostControlInputFrame(
    createRuntimeHostStartFrame({
      accessToken: ACCESS_TOKEN,
      allowedOrigins: [RENDERER_ORIGIN],
    }),
  );
  const shutdownReasons: RuntimeHostLifecycleReason[] = [];
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(String(chunk)));
  let starts = 0;
  const result = await runRuntimeHostControlSession({
    input: Readable.from([Buffer.from(`${start}${start}`)]),
    output,
    createInstanceId: () => "state-fixture",
    startHost() {
      starts += 1;
      return fakeRunningHost(shutdownReasons);
    },
  });
  assert.equal(result.code, RuntimeHostControlSessionResultCode.invalidControl);
  assert.equal(starts, 1);
  assert.deepEqual(shutdownReasons, [RuntimeHostLifecycleReason.controlError]);
  assert.deepEqual(
    chunks.map((chunk) => parseRuntimeHostControlOutputFrame(JSON.parse(chunk))?.type),
    ["ready"],
  );
});

test("validates the complete running identity before emitting ready", async () => {
  const shutdownReasons: RuntimeHostLifecycleReason[] = [];
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(String(chunk)));
  const result = await runRuntimeHostControlSession({
    input: Readable.from([
      Buffer.from(
        encodeRuntimeHostControlInputFrame(
          createRuntimeHostStartFrame({
            accessToken: ACCESS_TOKEN,
            allowedOrigins: [RENDERER_ORIGIN],
          }),
        ),
      ),
    ]),
    output,
    createInstanceId: () => "state-fixture",
    startHost() {
      const running = fakeRunningHost(shutdownReasons);
      return {
        ...running,
        identity: {
          ...running.identity,
          unexpected: "provider-specific",
        } as typeof running.identity,
      };
    },
  });
  assert.equal(result.code, RuntimeHostControlSessionResultCode.startupFailed);
  assert.deepEqual(shutdownReasons, [RuntimeHostLifecycleReason.controlError]);
  assert.deepEqual(
    chunks.map((chunk) => parseRuntimeHostControlOutputFrame(JSON.parse(chunk))?.type),
    ["startup-error"],
  );
});

test("treats control EOF after ready as parent exit and disposes without an ack", async () => {
  const shutdownReasons: RuntimeHostLifecycleReason[] = [];
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(String(chunk)));
  const result = await runRuntimeHostControlSession({
    input: Readable.from([
      Buffer.from(
        encodeRuntimeHostControlInputFrame(
          createRuntimeHostStartFrame({
            accessToken: ACCESS_TOKEN,
            allowedOrigins: [RENDERER_ORIGIN],
          }),
        ),
      ),
    ]),
    output,
    createInstanceId: () => "state-fixture",
    startHost: () => fakeRunningHost(shutdownReasons),
  });
  assert.equal(result.code, RuntimeHostControlSessionResultCode.controlDisconnected);
  assert.deepEqual(shutdownReasons, [RuntimeHostLifecycleReason.containerExit]);
  assert.deepEqual(
    chunks.map((chunk) => parseRuntimeHostControlOutputFrame(JSON.parse(chunk))?.type),
    ["ready"],
  );
  assert.equal(chunks.join("").includes(ACCESS_TOKEN), false);
});

test("cleans up a started Host when the ready writer fails", async () => {
  const shutdownReasons: RuntimeHostLifecycleReason[] = [];
  const failingOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error(`output failed without echoing ${ACCESS_TOKEN.length} secret bytes`));
    },
  });
  failingOutput.on("error", () => undefined);
  await assert.rejects(
    runRuntimeHostControlSession({
      input: Readable.from([
        Buffer.from(
          encodeRuntimeHostControlInputFrame(
            createRuntimeHostStartFrame({
              accessToken: ACCESS_TOKEN,
              allowedOrigins: [RENDERER_ORIGIN],
            }),
          ),
        ),
      ]),
      output: failingOutput,
      createInstanceId: () => "state-fixture",
      startHost: () => fakeRunningHost(shutdownReasons),
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Runtime Host control session failed." &&
      !error.message.includes(ACCESS_TOKEN),
  );
  assert.deepEqual(shutdownReasons, [RuntimeHostLifecycleReason.controlError]);
});

test("does not report success when the acknowledgement writer fails after shutdown", async () => {
  const shutdownReasons: RuntimeHostLifecycleReason[] = [];
  let writes = 0;
  const failingAckOutput = new Writable({
    write(_chunk, _encoding, callback) {
      writes += 1;
      callback(writes === 2 ? new Error("ack output failed") : undefined);
    },
  });
  failingAckOutput.on("error", () => undefined);
  const start = encodeRuntimeHostControlInputFrame(
    createRuntimeHostStartFrame({
      accessToken: ACCESS_TOKEN,
      allowedOrigins: [RENDERER_ORIGIN],
    }),
  );
  const shutdown = encodeRuntimeHostControlInputFrame(
    createRuntimeHostShutdownFrame({
      reason: RuntimeHostShutdownReason.requested,
      deadlineMs: 5_000,
    }),
  );
  await assert.rejects(
    runRuntimeHostControlSession({
      input: Readable.from([Buffer.from(`${start}${shutdown}`)]),
      output: failingAckOutput,
      createInstanceId: () => "state-fixture",
      startHost: () => fakeRunningHost(shutdownReasons),
    }),
    /Runtime Host control session failed/u,
  );
  assert.equal(writes, 2);
  assert.deepEqual(shutdownReasons, [RuntimeHostLifecycleReason.requested]);
});

test("cleans up a started Host and hides raw diagnostics when the input iterator fails", async () => {
  const shutdownReasons: RuntimeHostLifecycleReason[] = [];
  const output = new PassThrough();
  async function* failingInput(): AsyncIterable<Uint8Array> {
    yield Buffer.from(
      encodeRuntimeHostControlInputFrame(
        createRuntimeHostStartFrame({
          accessToken: ACCESS_TOKEN,
          allowedOrigins: [RENDERER_ORIGIN],
        }),
      ),
    );
    throw new Error(`/sensitive/path/${ACCESS_TOKEN}`);
  }
  await assert.rejects(
    runRuntimeHostControlSession({
      input: failingInput(),
      output,
      createInstanceId: () => "state-fixture",
      startHost: () => fakeRunningHost(shutdownReasons),
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Runtime Host control session failed." &&
      !error.message.includes(ACCESS_TOKEN) &&
      !error.message.includes("/sensitive/path"),
  );
  assert.deepEqual(shutdownReasons, [RuntimeHostLifecycleReason.controlError]);
});
