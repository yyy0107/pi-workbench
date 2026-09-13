import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_HOST_CONTROL_MAX_FRAME_BYTES,
  RUNTIME_HOST_CONTROL_VERSION,
  RUNTIME_HOST_PROTOCOL_VERSION,
  RuntimeHostControlDecodeError,
  RuntimeHostControlDecodeErrorCode,
  RuntimeHostShutdownReason,
  RuntimeHostStartupErrorCode,
  RuntimeHostControlNdjsonDecoder,
  createRuntimeHostHealth,
  createRuntimeHostIdentity,
  createRuntimeHostReadyFrame,
  createRuntimeHostShutdownAckFrame,
  createRuntimeHostShutdownFrame,
  createRuntimeHostStartFrame,
  createRuntimeHostStartupErrorFrame,
  encodeRuntimeHostControlInputFrame,
  encodeRuntimeHostControlOutputFrame,
  parseRuntimeHostControlInputFrame,
  parseRuntimeHostControlOutputFrame,
  parseRuntimeHostHealth,
  parseRuntimeHostIdentity,
  runtimeHostControlInputErrorCode,
} from "../src/runtime-host-control";

const ACCESS_TOKEN = "secret-that-must-stay-on-stdin";
const ALLOWED_ORIGINS = ["https://renderer.workbench.test"] as const;

test("defines exact immutable start and shutdown input frames", () => {
  const start = createRuntimeHostStartFrame({
    accessToken: ACCESS_TOKEN,
    allowedOrigins: ALLOWED_ORIGINS,
  });
  assert.deepEqual(start, {
    type: "start",
    controlVersion: RUNTIME_HOST_CONTROL_VERSION,
    authMode: "desktop-sidecar",
    accessToken: ACCESS_TOKEN,
    allowedOrigins: ALLOWED_ORIGINS,
  });
  assert.equal(Object.isFrozen(start), true);
  assert.equal(Object.isFrozen(start.allowedOrigins), true);

  const shutdown = createRuntimeHostShutdownFrame({
    reason: RuntimeHostShutdownReason.requested,
    deadlineMs: 5_000,
  });
  assert.deepEqual(shutdown, {
    type: "shutdown",
    controlVersion: RUNTIME_HOST_CONTROL_VERSION,
    reason: "requested",
    deadlineMs: 5_000,
  });
});

test("rejects extra keys, invalid versions, unsafe tokens, origins, reasons, and deadlines", () => {
  const validStart = {
    type: "start",
    controlVersion: RUNTIME_HOST_CONTROL_VERSION,
    authMode: "desktop-sidecar",
    accessToken: ACCESS_TOKEN,
    allowedOrigins: ALLOWED_ORIGINS,
  };
  assert.equal(
    parseRuntimeHostControlInputFrame({ ...validStart, tokenCopy: ACCESS_TOKEN }),
    undefined,
  );
  assert.equal(parseRuntimeHostControlInputFrame({ ...validStart, controlVersion: 2 }), undefined);
  assert.equal(
    parseRuntimeHostControlInputFrame({ ...validStart, accessToken: "bad token" }),
    undefined,
  );
  assert.equal(
    parseRuntimeHostControlInputFrame({ ...validStart, allowedOrigins: ["*"] }),
    undefined,
  );
  assert.equal(
    parseRuntimeHostControlInputFrame({
      ...validStart,
      allowedOrigins: ["https://renderer.workbench.test/path"],
    }),
    undefined,
  );
  assert.equal(
    parseRuntimeHostControlInputFrame({
      type: "shutdown",
      controlVersion: RUNTIME_HOST_CONTROL_VERSION,
      reason: "arbitrary-secret-bearing-reason",
      deadlineMs: 5_000,
    }),
    undefined,
  );
  assert.equal(
    parseRuntimeHostControlInputFrame({
      type: "shutdown",
      controlVersion: RUNTIME_HOST_CONTROL_VERSION,
      reason: RuntimeHostShutdownReason.requested,
      deadlineMs: 0,
    }),
    undefined,
  );
  assert.equal(
    parseRuntimeHostControlInputFrame({
      type: "shutdown",
      controlVersion: RUNTIME_HOST_CONTROL_VERSION,
      reason: RuntimeHostShutdownReason.requested,
      deadlineMs: 60_001,
    }),
    undefined,
  );
  assert.equal(
    runtimeHostControlInputErrorCode({ ...validStart, controlVersion: 2 }),
    RuntimeHostStartupErrorCode.unsupportedControlVersion,
  );
});

test("ready, startup errors, and shutdown acknowledgements are exact and credential-free", () => {
  const output = [
    createRuntimeHostReadyFrame({
      instanceId: "runtime-one",
      pid: 123,
      httpOrigin: "http://127.0.0.1:43127",
    }),
    createRuntimeHostStartupErrorFrame(RuntimeHostStartupErrorCode.startupFailed),
    createRuntimeHostShutdownAckFrame(),
  ];
  const serialized = output.map(encodeRuntimeHostControlOutputFrame).join("");
  assert.equal(serialized.includes(ACCESS_TOKEN), false);
  assert.equal(serialized.includes("/home/fixture"), false);
  for (const frame of output) assert.deepEqual(parseRuntimeHostControlOutputFrame(frame), frame);

  assert.equal(
    parseRuntimeHostControlOutputFrame({ ...output[0], accessToken: ACCESS_TOKEN }),
    undefined,
  );
  assert.equal(
    parseRuntimeHostControlOutputFrame({
      ...output[1],
      message: `Startup failed at /home/fixture with ${ACCESS_TOKEN}`,
    }),
    undefined,
  );
  assert.throws(() =>
    encodeRuntimeHostControlOutputFrame(
      createRuntimeHostStartFrame({
        accessToken: ACCESS_TOKEN,
        allowedOrigins: ALLOWED_ORIGINS,
      }),
    ),
  );
});

test("health and identity are generic, exact, and use the Host protocol identity", () => {
  const health = createRuntimeHostHealth("runtime-one");
  const identity = createRuntimeHostIdentity({ instanceId: "runtime-one", pid: 123 });
  assert.deepEqual(health, {
    status: "ok",
    hostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
    instanceId: "runtime-one",
  });
  assert.deepEqual(identity, {
    product: "workbench-runtime-host",
    hostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
    instanceId: "runtime-one",
    pid: 123,
  });
  assert.deepEqual(parseRuntimeHostHealth(health), health);
  assert.deepEqual(parseRuntimeHostIdentity(identity), identity);
  assert.equal(parseRuntimeHostIdentity({ ...identity, piVersion: "fixture" }), undefined);
});

test("NDJSON decoder handles split and coalesced frames with a mandatory final LF", () => {
  const start = encodeRuntimeHostControlInputFrame(
    createRuntimeHostStartFrame({ accessToken: ACCESS_TOKEN, allowedOrigins: ALLOWED_ORIGINS }),
  );
  const shutdown = encodeRuntimeHostControlInputFrame(
    createRuntimeHostShutdownFrame({
      reason: RuntimeHostShutdownReason.requested,
      deadlineMs: 5_000,
    }),
  );
  const decoder = new RuntimeHostControlNdjsonDecoder();
  assert.deepEqual(decoder.push(Buffer.from(start.slice(0, 11))), []);
  const records = decoder.push(Buffer.from(`${start.slice(11)}${shutdown}`));
  assert.equal(records.length, 2);
  assert.equal(parseRuntimeHostControlInputFrame(records[0])?.type, "start");
  assert.equal(parseRuntimeHostControlInputFrame(records[1])?.type, "shutdown");
  decoder.finish();

  const incomplete = new RuntimeHostControlNdjsonDecoder();
  incomplete.push(Buffer.from(start.trimEnd()));
  assert.throws(
    () => incomplete.finish(),
    (error: unknown) =>
      error instanceof RuntimeHostControlDecodeError &&
      error.code === RuntimeHostControlDecodeErrorCode.incompleteFrame,
  );
});

test("NDJSON decoder rejects oversized, invalid UTF-8, invalid JSON, and empty records safely", () => {
  const oversized = new RuntimeHostControlNdjsonDecoder();
  assert.throws(
    () => oversized.push(Buffer.alloc(RUNTIME_HOST_CONTROL_MAX_FRAME_BYTES + 1, 0x61)),
    (error: unknown) =>
      error instanceof RuntimeHostControlDecodeError &&
      error.code === RuntimeHostControlDecodeErrorCode.frameTooLarge,
  );

  const invalidEncoding = new RuntimeHostControlNdjsonDecoder();
  assert.throws(
    () => invalidEncoding.push(Uint8Array.from([0xff, 0x0a])),
    (error: unknown) =>
      error instanceof RuntimeHostControlDecodeError &&
      error.code === RuntimeHostControlDecodeErrorCode.invalidEncoding,
  );

  for (const input of ["{not-json}\n", "\n"]) {
    const invalidJson = new RuntimeHostControlNdjsonDecoder();
    assert.throws(
      () => invalidJson.push(Buffer.from(input)),
      (error: unknown) =>
        error instanceof RuntimeHostControlDecodeError &&
        error.code === RuntimeHostControlDecodeErrorCode.invalidJson,
    );
  }
});
