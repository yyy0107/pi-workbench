import assert from "node:assert/strict";
import test from "node:test";

import type { RpcError } from "../../rpc-contracts";
import type { HostStreamPayload, MuxStreamPayload, ServerRequest } from "../../stream-contracts";

const { createStreamHub, getStreamHub, STREAM_HUB_SYMBOL } = (await import(
  new URL("./stream-hub.ts", import.meta.url).href
)) as typeof import("./stream-hub");

function sessionEvent(seq: number): MuxStreamPayload {
  return {
    type: "session/event",
    sessionId: "session-1",
    event: {
      type: "message",
      seq,
      time: 1_725_000_000_000 + seq,
      data: { seq },
    },
  };
}

test("isolates mux and host routes and gives every frame a stable envelope", async () => {
  let nextId = 0;
  const hub = createStreamHub({ createRpcId: () => `rpc-${++nextId}` });
  const muxFrames: ServerRequest<MuxStreamPayload>[] = [];
  const hostFrames: ServerRequest<HostStreamPayload>[] = [];

  const mux = hub.subscribe("mux", {
    onFrame: (frame) => muxFrames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  const host = hub.subscribe("host", {
    onFrame: (frame) => hostFrames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  await Promise.all([mux.ready, host.ready]);

  hub.publishMux(sessionEvent(1), { rpcId: "session-rpc" });
  hub.publishHost({ type: "host/session-status", sessionId: "session-1", running: true });

  assert.equal(muxFrames.length, 1);
  assert.equal(hostFrames.length, 1);
  assert.equal(muxFrames[0]?.rpcId, "session-rpc");
  assert.equal(muxFrames[0]?.method, muxFrames[0]?.payload.type);
  assert.equal(hostFrames[0]?.method, "host/session-status");
  assert.equal(hub.watermark("mux"), 1);
  assert.equal(hub.watermark("host"), 1);
});

test("publishes prompt admission with the original RPC id without retaining it", async () => {
  const hub = createStreamHub({ createRpcId: () => "generated-rpc" });
  const liveFrames: ServerRequest<MuxStreamPayload>[] = [];
  const live = hub.subscribe("mux", {
    onFrame: (frame) => liveFrames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  await live.ready;

  hub.publishMux(
    {
      type: "session/prompt-accepted",
      sessionId: "session-1",
      mode: "queue",
      running: true,
    },
    { rpcId: "prompt-http-rpc" },
  );

  assert.deepEqual(liveFrames, [
    {
      type: "server-request",
      rpcId: "prompt-http-rpc",
      method: "session/prompt-accepted",
      payload: {
        type: "session/prompt-accepted",
        sessionId: "session-1",
        mode: "queue",
        running: true,
      },
    },
  ]);
  live.close();

  const reconnectFrames: ServerRequest<MuxStreamPayload>[] = [];
  const reconnect = hub.subscribe("mux", {
    onFrame: (frame) => reconnectFrames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  await reconnect.ready;
  assert.deepEqual(reconnectFrames, []);
});

test("buffers post-watermark frames until bootstrap and subscribed frames finish", async () => {
  let nextId = 0;
  const hub = createStreamHub({ createRpcId: () => `rpc-${++nextId}` });
  const frames: ServerRequest<MuxStreamPayload>[] = [];
  let capturedWatermark = -1;

  const subscription = hub.subscribe(
    "mux",
    {
      onFrame: (frame) => frames.push(frame),
      onError: (error) => assert.fail(error.message),
    },
    {
      bootstrap: ({ watermark }) => {
        capturedWatermark = watermark;
        hub.publishMux(sessionEvent(2), { rpcId: "live" });
        return [
          { payload: sessionEvent(1), rpcId: "snapshot" },
          {
            payload: {
              type: "session/subscribed",
              sessionId: "session-1",
              lastSeq: 1,
            },
            rpcId: "subscribed",
          },
        ];
      },
    },
  );

  await subscription.ready;
  assert.equal(capturedWatermark, 0);
  assert.deepEqual(
    frames.map((frame) => frame.rpcId),
    ["snapshot", "subscribed", "live"],
  );
  assert.deepEqual(
    frames.map((frame) => frame.payload.type),
    ["session/event", "session/subscribed", "session/event"],
  );
});

test("stores only detached plain JSON frames", async () => {
  const hub = createStreamHub({ createRpcId: () => "rpc-json" });
  const frames: ServerRequest<MuxStreamPayload>[] = [];
  const subscription = hub.subscribe("mux", {
    onFrame: (frame) => frames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  await subscription.ready;

  const payload = sessionEvent(1);
  hub.publishMux(payload);
  if (payload.type !== "session/event") assert.fail("expected a session event");
  payload.event.data = { changed: true };

  const delivered = frames[0];
  assert.ok(delivered);
  assert.equal(delivered.payload.type, "session/event");
  assert.deepEqual(delivered.payload.event.data, { seq: 1 });
});

test("bootstraps current session watermarks for later mux subscribers", async () => {
  const hub = createStreamHub({ createRpcId: () => "rpc-retained" });
  hub.publishMux(sessionEvent(7));
  const frames: ServerRequest<MuxStreamPayload>[] = [];
  const subscription = hub.subscribe("mux", {
    onFrame: (frame) => frames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  await subscription.ready;

  assert.deepEqual(
    frames.map((frame) => frame.payload),
    [{ type: "session/subscribed", sessionId: "session-1", lastSeq: 7 }],
  );
  hub.publishHost({ type: "host/session-removed", sessionId: "session-1" });
  const afterRemoval: ServerRequest<MuxStreamPayload>[] = [];
  const second = hub.subscribe("mux", {
    onFrame: (frame) => afterRemoval.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  await second.ready;
  assert.deepEqual(afterRemoval, []);
});

test("retains the latest authoritative queue snapshot after the session watermark", async () => {
  let nextId = 0;
  const hub = createStreamHub({ createRpcId: () => `rpc-${++nextId}` });
  hub.publishMux({ type: "session/subscribed", sessionId: "session-1", lastSeq: 3 });
  hub.publishMux({
    type: "session/queue",
    sessionId: "session-1",
    items: [
      {
        id: "queue-1",
        placement: "queued",
        message: {
          id: "queue-1",
          role: "user",
          content: [{ type: "text", text: "latest" }],
          source: { kind: "user" },
        },
      },
    ],
  });
  hub.publishMux({ type: "session/queue", sessionId: "session-1", items: [] });

  const frames: ServerRequest<MuxStreamPayload>[] = [];
  const subscription = hub.subscribe("mux", {
    onFrame: (frame) => frames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  await subscription.ready;
  assert.deepEqual(
    frames.map((frame) => frame.payload),
    [
      { type: "session/subscribed", sessionId: "session-1", lastSeq: 3 },
      { type: "session/queue", sessionId: "session-1", items: [] },
    ],
  );

  hub.publishHost({ type: "host/session-removed", sessionId: "session-1" });
  const afterRemoval: ServerRequest<MuxStreamPayload>[] = [];
  const second = hub.subscribe("mux", {
    onFrame: (frame) => afterRemoval.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  await second.ready;
  assert.deepEqual(afterRemoval, []);
});

test("replays pending interactive requests with stable ids and withdraws resolved requests", async () => {
  let nextId = 0;
  const hub = createStreamHub({ createRpcId: () => `rpc-${++nextId}` });
  hub.publishMux(
    {
      type: "question/requested",
      sessionId: "session-1",
      questions: [{ id: "target", question: "Target?" }],
    },
    { rpcId: "question-stable" },
  );
  hub.publishMux(
    {
      type: "approval/requested",
      sessionId: "session-1",
      approvalId: "approval-1",
      toolName: "shell",
    },
    { rpcId: "approval-stable" },
  );

  const replayed: ServerRequest<MuxStreamPayload>[] = [];
  const first = hub.subscribe("mux", {
    onFrame: (frame) => replayed.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  await first.ready;
  assert.deepEqual(
    replayed.map((frame) => [frame.rpcId, frame.payload.type]),
    [
      ["question-stable", "question/requested"],
      ["approval-stable", "approval/requested"],
    ],
  );

  hub.publishMux({
    type: "question/resolved",
    sessionId: "session-1",
    questionRpcId: "question-stable",
    outcome: "answered",
  });
  hub.publishMux({
    type: "approval/resolved",
    sessionId: "session-1",
    approvalId: "approval-1",
    outcome: "rejected",
  });

  const afterResolution: ServerRequest<MuxStreamPayload>[] = [];
  const second = hub.subscribe("mux", {
    onFrame: (frame) => afterResolution.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  await second.ready;
  assert.deepEqual(afterResolution, []);
});

test("adds retained interactive requests after a caller-provided mux bootstrap", async () => {
  const hub = createStreamHub({ createRpcId: () => "generated" });
  hub.publishMux(
    {
      type: "question/requested",
      sessionId: "session-1",
      questions: [{ id: "name", question: "Name?" }],
    },
    { rpcId: "pending-question" },
  );
  const frames: ServerRequest<MuxStreamPayload>[] = [];
  const subscription = hub.subscribe(
    "mux",
    {
      onFrame: (frame) => frames.push(frame),
      onError: (error) => assert.fail(error.message),
    },
    {
      bootstrap: () => [
        {
          rpcId: "custom",
          payload: { type: "session/subscribed", sessionId: "session-1", lastSeq: 4 },
        },
      ],
    },
  );
  await subscription.ready;
  assert.deepEqual(
    frames.map((frame) => frame.rpcId),
    ["custom", "pending-question"],
  );
});

test("turns serialization and explicit source failures into terminal subscriber errors", async () => {
  const hub = createStreamHub({ createRpcId: () => "rpc-error" });
  const errors: RpcError[] = [];
  const frames: ServerRequest<MuxStreamPayload>[] = [];
  const subscription = hub.subscribe("mux", {
    onFrame: (frame) => frames.push(frame),
    onError: (error) => errors.push(error),
  });
  await subscription.ready;

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const invalid = sessionEvent(1);
  if (invalid.type !== "session/event") assert.fail("expected a session event");
  invalid.event.data = cyclic;
  assert.throws(() => hub.publishMux(invalid), /circular|JSON serializable/i);

  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.code, "internal");
  hub.publishMux(sessionEvent(2));
  assert.equal(frames.length, 0, "failed subscribers stay detached");

  const explicitErrors: RpcError[] = [];
  const second = hub.subscribe("mux", {
    onFrame: (frame) => {
      assert.equal(frame.payload.type, "session/subscribed");
    },
    onError: (error) => explicitErrors.push(error),
  });
  await second.ready;
  hub.fail("mux", { code: "internal", message: "source stopped", details: {} });
  assert.equal(explicitErrors[0]?.message, "source stopped");

  const unserializableErrors: RpcError[] = [];
  const third = hub.subscribe("mux", {
    onFrame: (frame) => {
      assert.equal(frame.payload.type, "session/subscribed");
    },
    onError: (error) => unserializableErrors.push(error),
  });
  await third.ready;
  const cyclicDetails: Record<string, unknown> = {};
  cyclicDetails.self = cyclicDetails;
  hub.fail("mux", { code: "internal", message: "cyclic", details: cyclicDetails });
  assert.equal(unserializableErrors[0]?.message, "The stream error was not JSON serializable.");
});

test("uses one global Symbol.for hub across module reload boundaries", () => {
  assert.equal(Symbol.keyFor(STREAM_HUB_SYMBOL), "workbench-ui.pi.stream-hub.v1");
  assert.equal(getStreamHub(), getStreamHub());
});
