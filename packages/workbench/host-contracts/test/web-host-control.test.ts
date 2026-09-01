import assert from "node:assert/strict";
import test from "node:test";

import {
  WEB_HOST_CONTROL_MAX_FRAME_BYTES,
  WEB_HOST_CONTROL_VERSION,
  WebHostControlDecodeError,
  WebHostControlDecodeErrorCode,
  WebHostShutdownReason,
  WebHostStartupErrorCode,
  WebHostControlNdjsonDecoder,
  createWebHostReadyFrame,
  createWebHostShutdownAckFrame,
  createWebHostShutdownFrame,
  createWebHostStartFrame,
  createWebHostStartupErrorFrame,
  encodeWebHostControlInputFrame,
  encodeWebHostControlOutputFrame,
  parseWebHostControlInputFrame,
  parseWebHostControlOutputFrame,
  webHostControlInputErrorCode,
} from "../src/web-host-control";

test("defines exact immutable loopback Web Host control frames", () => {
  const start = createWebHostStartFrame({ host: "127.0.0.1", port: 0 });
  const shutdown = createWebHostShutdownFrame({
    reason: WebHostShutdownReason.requested,
    deadlineMs: 5_000,
  });

  assert.deepEqual(start, {
    type: "start",
    controlVersion: WEB_HOST_CONTROL_VERSION,
    host: "127.0.0.1",
    port: 0,
  });
  assert.deepEqual(shutdown, {
    type: "shutdown",
    controlVersion: WEB_HOST_CONTROL_VERSION,
    reason: "requested",
    deadlineMs: 5_000,
  });
  assert.equal(Object.isFrozen(start), true);
  assert.equal(Object.isFrozen(shutdown), true);
});

test("rejects unsafe Web Host start and shutdown inputs", () => {
  const validStart = {
    type: "start",
    controlVersion: WEB_HOST_CONTROL_VERSION,
    host: "127.0.0.1",
    port: 43127,
  };

  for (const invalid of [
    { ...validStart, extra: true },
    { ...validStart, controlVersion: 2 },
    { ...validStart, host: "localhost" },
    { ...validStart, port: -1 },
    { ...validStart, port: 65_536 },
    { ...validStart, port: 1.5 },
    {
      type: "shutdown",
      controlVersion: WEB_HOST_CONTROL_VERSION,
      reason: "unbounded",
      deadlineMs: 5_000,
    },
    {
      type: "shutdown",
      controlVersion: WEB_HOST_CONTROL_VERSION,
      reason: WebHostShutdownReason.requested,
      deadlineMs: 0,
    },
  ]) {
    assert.equal(parseWebHostControlInputFrame(invalid), undefined);
  }

  assert.equal(
    webHostControlInputErrorCode({ ...validStart, controlVersion: 2 }),
    WebHostStartupErrorCode.unsupportedControlVersion,
  );
  assert.equal(
    webHostControlInputErrorCode({ ...validStart, host: "localhost" }),
    WebHostStartupErrorCode.invalidControlFrame,
  );
});

test("ready, startup errors, and acknowledgements remain exact and local", () => {
  const output = [
    createWebHostReadyFrame({
      instanceId: "web-one",
      pid: 123,
      httpOrigin: "http://127.0.0.1:43127",
    }),
    createWebHostStartupErrorFrame(WebHostStartupErrorCode.startupFailed),
    createWebHostShutdownAckFrame(),
  ];
  const serialized = output.map(encodeWebHostControlOutputFrame).join("");
  assert.equal(serialized.includes("accessToken"), false);
  assert.equal(serialized.includes("/home/fixture"), false);
  for (const frame of output) {
    assert.deepEqual(parseWebHostControlOutputFrame(frame), frame);
    assert.equal(Object.isFrozen(frame), true);
  }

  assert.equal(
    parseWebHostControlOutputFrame({ ...output[0], httpOrigin: "http://localhost:43127" }),
    undefined,
  );
  assert.equal(
    parseWebHostControlOutputFrame({ ...output[0], accessToken: "never-allowed" }),
    undefined,
  );
  assert.equal(
    parseWebHostControlOutputFrame({ ...output[1], message: "arbitrary diagnostic" }),
    undefined,
  );
});

test("NDJSON framing handles split/coalesced records and requires final LF", () => {
  const start = encodeWebHostControlInputFrame(
    createWebHostStartFrame({ host: "127.0.0.1", port: 0 }),
  );
  const shutdown = encodeWebHostControlInputFrame(
    createWebHostShutdownFrame({
      reason: WebHostShutdownReason.requested,
      deadlineMs: 5_000,
    }),
  );
  const decoder = new WebHostControlNdjsonDecoder();
  assert.deepEqual(decoder.push(Buffer.from(start.slice(0, 8))), []);
  const records = decoder.push(Buffer.from(`${start.slice(8)}${shutdown}`));
  assert.equal(records.length, 2);
  assert.equal(parseWebHostControlInputFrame(records[0])?.type, "start");
  assert.equal(parseWebHostControlInputFrame(records[1])?.type, "shutdown");
  decoder.finish();

  const incomplete = new WebHostControlNdjsonDecoder();
  incomplete.push(Buffer.from(start.trimEnd()));
  assert.throws(
    () => incomplete.finish(),
    (error: unknown) =>
      error instanceof WebHostControlDecodeError &&
      error.code === WebHostControlDecodeErrorCode.incompleteFrame,
  );
});

test("NDJSON framing rejects oversized, invalid UTF-8, invalid JSON, and empty records", () => {
  const oversized = new WebHostControlNdjsonDecoder();
  assert.throws(
    () => oversized.push(Buffer.alloc(WEB_HOST_CONTROL_MAX_FRAME_BYTES + 1, 0x61)),
    (error: unknown) =>
      error instanceof WebHostControlDecodeError &&
      error.code === WebHostControlDecodeErrorCode.frameTooLarge,
  );

  const invalidEncoding = new WebHostControlNdjsonDecoder();
  assert.throws(
    () => invalidEncoding.push(Uint8Array.from([0xff, 0x0a])),
    (error: unknown) =>
      error instanceof WebHostControlDecodeError &&
      error.code === WebHostControlDecodeErrorCode.invalidEncoding,
  );

  for (const input of ["{not-json}\n", "\n"]) {
    const invalidJson = new WebHostControlNdjsonDecoder();
    assert.throws(
      () => invalidJson.push(Buffer.from(input)),
      (error: unknown) =>
        error instanceof WebHostControlDecodeError &&
        error.code === WebHostControlDecodeErrorCode.invalidJson,
    );
  }
});
