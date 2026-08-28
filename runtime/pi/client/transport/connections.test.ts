import assert from "node:assert/strict";
import test from "node:test";

import type { PiEvent } from "@/runtime/pi/contracts/pi";
import type {
  HostStreamPayload,
  MuxStreamPayload,
  ServerRequest,
} from "@/runtime/pi/contracts/stream";
import type { PiConnectionTimers, PiWebSocket, PiWebSocketMessageEvent } from "./connections";

const { PiConnectionController } = (await import(
  new URL("./connections.ts", import.meta.url).href
)) as typeof import("./connections");

class FakeSocket implements PiWebSocket {
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: PiWebSocketMessageEvent) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  readonly sendCalls: unknown[] = [];
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  send(data: unknown): void {
    this.sendCalls.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 2;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  message(data: unknown): void {
    this.onmessage?.({ data });
  }

  error(): void {
    this.onerror?.({});
  }

  remoteClose(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
}

interface TimerTask {
  id: number;
  callback: () => void;
  delayMs: number;
  cleared: boolean;
}

class FakeTimers implements PiConnectionTimers {
  private nextId = 0;
  readonly tasks: TimerTask[] = [];

  setTimeout(callback: () => void, delayMs: number): number {
    const task = { id: ++this.nextId, callback, delayMs, cleared: false };
    this.tasks.push(task);
    return task.id;
  }

  clearTimeout(timer: unknown): void {
    const task = this.tasks.find((candidate) => candidate.id === timer);
    if (task) task.cleared = true;
  }

  pending(): TimerTask[] {
    return this.tasks.filter((task) => !task.cleared);
  }

  runNext(): TimerTask {
    const task = this.pending()[0];
    assert.ok(task, "expected a pending timer");
    task.cleared = true;
    task.callback();
    return task;
  }
}

function serverFrame(
  payload: Record<string, unknown>,
  method = payload.type,
  rpcId = "rpc-1",
): string {
  return JSON.stringify({
    type: "server-request",
    rpcId,
    method,
    payload,
  });
}

function sessionSummary(id: string) {
  return {
    id,
    cwd: "/workspace",
    workspace: { id: "workspace-1", name: "Workspace", cwd: "/workspace" },
    created: "2026-08-20T00:00:00.000Z",
    modified: "2026-08-20T00:00:01.000Z",
    messageCount: 1,
    firstMessage: "Realtime session",
    transient: false,
    running: false,
    executionOrigin: {
      version: 1,
      origin: "execution",
      workflowId: "workflow-1",
      workflowName: "Daily review",
      workflowKind: "automation",
      runId: "run-1",
      nodeId: "agent-1",
      attempt: 1,
      source: "schedule",
    },
  };
}

function socketPair(sockets: FakeSocket[], generation: number): [FakeSocket, FakeSocket] {
  const mux = sockets[(generation - 1) * 2];
  const host = sockets[(generation - 1) * 2 + 1];
  assert.ok(mux);
  assert.ok(host);
  return [mux, host];
}

test("reconnects both sockets as one generation and ignores stale generation frames", () => {
  const timers = new FakeTimers();
  const sockets: FakeSocket[] = [];
  const hostFrames: HostStreamPayload[] = [];
  const readyGenerations: number[] = [];
  const controller = new PiConnectionController({
    webSocketFactory: (path) => {
      const socket = new FakeSocket(path);
      sockets.push(socket);
      return socket;
    },
    timers,
    random: () => 0,
    onHostFrame: (payload) => hostFrames.push(payload),
    onGenerationReady: (generation) => readyGenerations.push(generation),
  });

  controller.startRunningEvents(() => undefined);
  assert.deepEqual(
    sockets.map((socket) => socket.path),
    ["/api/events.mux", "/api/events.host"],
  );

  const [firstMux, firstHost] = socketPair(sockets, 1);
  firstMux.open();
  firstHost.message(
    serverFrame({ type: "host/session-status", sessionId: "before-ready", running: true }),
  );
  assert.equal(hostFrames.length, 0, "frames wait for both sockets to open");
  firstHost.open();
  assert.deepEqual(readyGenerations, [1]);
  assert.equal(hostFrames.length, 1);

  firstMux.remoteClose();
  assert.ok(firstHost.closeCalls.length > 0, "the peer socket closes with its generation");
  assert.equal(timers.pending().length, 1, "one reconnect timer owns the generation");
  const firstDelay = timers.pending()[0]?.delayMs;
  assert.equal(firstDelay, 125);

  firstHost.message(
    serverFrame({ type: "host/session-status", sessionId: "stale", running: true }),
  );
  assert.equal(hostFrames.length, 1);

  timers.runNext();
  assert.deepEqual(
    sockets.map((socket) => socket.path),
    ["/api/events.mux", "/api/events.host", "/api/events.mux", "/api/events.host"],
  );
  const [secondMux, secondHost] = socketPair(sockets, 2);
  secondHost.open();
  assert.deepEqual(readyGenerations, [1]);
  secondMux.open();
  assert.deepEqual(readyGenerations, [1, 2]);

  for (const socket of sockets) assert.equal(socket.sendCalls.length, 0);
  controller.dispose();
  secondHost.remoteClose();
  assert.equal(timers.pending().length, 0, "dispose permanently disables reconnects");
});

test("buffers a server-sized retained baseline until both sockets are ready", () => {
  const sockets: FakeSocket[] = [];
  let muxFrameCount = 0;
  const controller = new PiConnectionController({
    webSocketFactory: (path) => {
      const socket = new FakeSocket(path);
      sockets.push(socket);
      return socket;
    },
    onMuxFrame: () => {
      muxFrameCount += 1;
    },
  });

  controller.startRunningEvents(() => undefined);
  const [mux, host] = socketPair(sockets, 1);
  mux.open();
  for (let index = 0; index < 1_001; index += 1) {
    mux.message(
      serverFrame({ type: "session/subscribed", sessionId: `session-${index}`, lastSeq: -1 }),
    );
  }
  assert.equal(muxFrameCount, 0);
  host.open();

  assert.equal(muxFrameCount, 1_001);
  assert.equal(sockets.length, 2);
  controller.dispose();
});

test("routes canonical mux session frames to only the matching legacy listener", async () => {
  const timers = new FakeTimers();
  const sockets: FakeSocket[] = [];
  const events: PiEvent[] = [];
  const muxFrames: ServerRequest<MuxStreamPayload>[] = [];
  const controller = new PiConnectionController({
    webSocketFactory: (path) => {
      const socket = new FakeSocket(path);
      sockets.push(socket);
      return socket;
    },
    timers,
    onMuxFrame: (frame) => muxFrames.push(frame),
  });

  const connected = controller.ensureSessionEvents("session-1", (event) => events.push(event));
  const [mux, host] = socketPair(sockets, 1);
  mux.open();
  host.open();
  await connected;

  mux.message(
    serverFrame({
      type: "session/event",
      sessionId: "session-1",
      runTiming: { startedAt: 1_724_999_999_000, elapsedMs: 1_000 },
      event: {
        type: "message_start",
        seq: 4,
        time: 1_725_000_000_000,
        data: { message: { role: "assistant", content: [] }, type: "spoof", sequence: 99 },
      },
    }),
  );
  mux.message(
    serverFrame({
      type: "session/message-snapshot",
      format: "pi-messages-v1",
      sessionId: "session-1",
      streamId: "stream-1",
      revision: 1,
      startSeq: 4,
      time: 1_725_000_000_001,
      message: { role: "assistant", content: [{ type: "text", text: "partial" }] },
    }),
  );
  mux.message(
    serverFrame({
      type: "session/event",
      sessionId: "session-2",
      event: { type: "agent_start", seq: 1, time: 1, data: {} },
    }),
  );
  mux.message(serverFrame({ type: "session/subscribed", sessionId: "session-1", lastSeq: 4 }));
  mux.message(
    serverFrame(
      { type: "session/subscribed", sessionId: "session-1", lastSeq: 5 },
      "session/event",
    ),
  );
  host.message(
    serverFrame({
      type: "session/event",
      sessionId: "session-1",
      event: { type: "agent_start", seq: 6, time: 1, data: {} },
    }),
  );
  mux.message(
    serverFrame({
      type: "session/queue",
      sessionId: "session-1",
      items: [
        {
          id: "queue-1",
          placement: "queued",
          message: {
            id: "message-1",
            role: "user",
            content: [{ type: "text", text: "next" }],
            source: { kind: "rpc" },
          },
        },
      ],
    }),
  );
  mux.message(
    serverFrame(
      {
        type: "session/prompt-accepted",
        sessionId: "session-1",
        mode: "queue",
        running: true,
      },
      "session/prompt-accepted",
      "prompt-http-rpc",
    ),
  );
  mux.message(
    serverFrame({
      type: "session/jobs",
      sessionId: "session-1",
      jobs: [{ id: "bad", kind: "tool", label: "Bad", status: "unknown", startedAt: 1 }],
    }),
  );
  mux.message(
    serverFrame({
      type: "session/context-trace",
      sessionId: "session-1",
      event: {
        schemaVersion: 1,
        traceId: "activation-1:0",
        sessionId: "session-1",
        activationId: "activation-1",
        seq: 0,
        time: 1_725_000_000_002,
        kind: "round-start",
        detailBytes: 48,
        truncated: false,
        redacted: false,
        roundId: "round-1",
      },
    }),
  );
  mux.message(
    serverFrame({
      type: "session/context-trace",
      sessionId: "session-1",
      event: {
        schemaVersion: 1,
        traceId: "activation-1:1",
        sessionId: "spoofed-session",
        activationId: "activation-1",
        seq: 1,
        time: 1_725_000_000_003,
        kind: "run-start",
        detailBytes: 20,
        truncated: false,
        redacted: false,
      },
    }),
  );

  assert.deepEqual(events, [
    {
      message: { role: "assistant", content: [] },
      type: "message_start",
      sequence: 4,
      eventTime: 1_725_000_000_000,
      runTiming: { startedAt: 1_724_999_999_000, elapsedMs: 1_000 },
    },
    {
      message: { role: "assistant", content: [{ type: "text", text: "partial" }] },
      type: "message_update",
      eventTime: 1_725_000_000_001,
      transientKind: "snapshot",
      transientStreamId: "stream-1",
      transientRevision: 1,
      transientMessageStartSeq: 4,
    },
    { type: "subscribed", sequence: 4 },
  ]);
  assert.deepEqual(
    muxFrames.map((frame) => frame.payload.type),
    [
      "session/event",
      "session/message-snapshot",
      "session/event",
      "session/subscribed",
      "session/queue",
      "session/prompt-accepted",
      "session/context-trace",
    ],
  );
  assert.equal(
    muxFrames.find((frame) => frame.payload.type === "session/prompt-accepted")?.rpcId,
    "prompt-http-rpc",
  );
  assert.equal(mux.sendCalls.length, 0);
  assert.equal(host.sendCalls.length, 0);

  controller.closeSession("session-1");
  mux.message(serverFrame({ type: "session/subscribed", sessionId: "session-1", lastSeq: 7 }));
  assert.equal(events.length, 3);
  controller.dispose();
});

test("late session listeners receive the durable watermark before the active stream snapshot", async () => {
  const sockets: FakeSocket[] = [];
  const events: PiEvent[] = [];
  const controller = new PiConnectionController({
    webSocketFactory: (path) => {
      const socket = new FakeSocket(path);
      sockets.push(socket);
      return socket;
    },
  });

  controller.startRunningEvents(() => undefined);
  const [mux, host] = socketPair(sockets, 1);
  mux.open();
  host.open();
  mux.message(serverFrame({ type: "session/subscribed", sessionId: "session-late", lastSeq: 7 }));
  mux.message(
    serverFrame({
      type: "session/message-snapshot",
      format: "pi-messages-v1",
      sessionId: "session-late",
      streamId: "stream-late",
      revision: 2,
      startSeq: 7,
      time: 123,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "partial" }],
      },
    }),
  );
  mux.message(
    serverFrame({
      type: "session/event",
      sessionId: "session-late",
      event: { type: "session_info_changed", seq: 8, time: 124, data: { name: "renamed" } },
    }),
  );

  await controller.ensureSessionEvents("session-late", (event) => events.push(event));
  assert.deepEqual(events, [
    { type: "subscribed", sequence: 8 },
    {
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "partial" }],
      },
      eventTime: 123,
      transientKind: "snapshot",
      transientStreamId: "stream-late",
      transientRevision: 2,
      transientMessageStartSeq: 7,
    },
  ]);

  mux.message(
    serverFrame({
      type: "session/message-update",
      format: "pi-messages-v1",
      sessionId: "session-late",
      streamId: "stream-late",
      revision: 3,
      startSeq: 7,
      time: 125,
      message: { role: "assistant" },
      update: { type: "text_delta", contentIndex: 0, delta: " text" },
    }),
  );
  const liveMessage = events.at(-1)?.message as
    | { content?: Array<{ type?: string; text?: string }> }
    | undefined;
  assert.equal(liveMessage?.content?.[0]?.text, "partial text");

  mux.message(
    serverFrame({
      type: "session/event",
      sessionId: "session-late",
      event: { type: "agent_settled", seq: 9, time: 126, data: {} },
    }),
  );
  assert.deepEqual(events.at(-1), { type: "agent_settled", sequence: 9, eventTime: 126 });
  controller.dispose();
});

test("invalidates the paired generation when a compact stream revision has a gap", async () => {
  const timers = new FakeTimers();
  const sockets: FakeSocket[] = [];
  const controller = new PiConnectionController({
    webSocketFactory: (path) => {
      const socket = new FakeSocket(path);
      sockets.push(socket);
      return socket;
    },
    timers,
  });

  const connected = controller.ensureSessionEvents("session-gap", () => undefined);
  const [mux, host] = socketPair(sockets, 1);
  mux.open();
  host.open();
  await connected;
  mux.message(
    serverFrame({
      type: "session/event",
      sessionId: "session-gap",
      event: {
        type: "message_start",
        seq: 1,
        time: 1,
        data: { message: { role: "assistant", content: [] } },
      },
    }),
  );
  mux.message(
    serverFrame({
      type: "session/message-update",
      format: "pi-messages-v1",
      sessionId: "session-gap",
      streamId: "stream-gap",
      revision: 2,
      startSeq: 1,
      time: 2,
      message: { role: "assistant" },
      update: { type: "text_start", contentIndex: 0 },
    }),
  );

  assert.equal(mux.closeCalls.at(-1)?.reason, "generation closed");
  assert.equal(host.closeCalls.at(-1)?.reason, "generation closed");
  assert.equal(timers.pending().length, 1);
  controller.dispose();
});

test("a branch subscription can reset the retained watermark to a shared prefix", async () => {
  const sockets: FakeSocket[] = [];
  const events: PiEvent[] = [];
  const controller = new PiConnectionController({
    webSocketFactory: (path) => {
      const socket = new FakeSocket(path);
      sockets.push(socket);
      return socket;
    },
  });

  controller.startRunningEvents(() => undefined);
  const [mux, host] = socketPair(sockets, 1);
  mux.open();
  host.open();
  mux.message(
    serverFrame({ type: "session/subscribed", sessionId: "session-branch", lastSeq: 12 }),
  );
  mux.message(serverFrame({ type: "session/subscribed", sessionId: "session-branch", lastSeq: 3 }));

  await controller.ensureSessionEvents("session-branch", (event) => events.push(event));
  assert.deepEqual(events, [{ type: "subscribed", sequence: 3 }]);
  controller.dispose();
});

test("aggregates host session status while forwarding every valid host payload", () => {
  const sockets: FakeSocket[] = [];
  const runningSnapshots: string[][] = [];
  const hostTypes: string[] = [];
  const controller = new PiConnectionController({
    webSocketFactory: (path) => {
      const socket = new FakeSocket(path);
      sockets.push(socket);
      return socket;
    },
    onHostFrame: (payload) => hostTypes.push(payload.type),
  });

  controller.startRunningEvents((sessionIds) => runningSnapshots.push(sessionIds));
  const [mux, host] = socketPair(sockets, 1);
  mux.open();
  host.open();

  host.message(serverFrame({ type: "host/session-status", sessionId: "session-b", running: true }));
  host.message(serverFrame({ type: "host/session-status", sessionId: "session-a", running: true }));
  host.message(
    serverFrame({ type: "host/session-status", sessionId: "session-b", running: false }),
  );
  host.message(
    serverFrame({
      type: "host/session-interaction-status",
      sessionId: "session-b",
      waitingForUserInput: true,
    }),
  );
  host.message(
    serverFrame({
      type: "host/workspace-changed",
      workspace: {
        workspaceId: "workspace-1",
        path: "/workspace",
        title: "Workspace",
        sessionIds: [],
        createdAt: "2026-08-19T00:00:00.000Z",
        updatedAt: "2026-08-19T00:00:00.000Z",
      },
    }),
  );
  host.message(
    serverFrame({
      type: "host/session-changed",
      sessionId: "session-live",
      summary: sessionSummary("session-live"),
    }),
  );
  host.message(
    serverFrame({
      type: "host/session-archive-changed",
      sessionId: "session-live",
      archived: false,
    }),
  );
  host.message(
    serverFrame({
      type: "host/workspace-pinned-changed",
      workspaceId: "workspace-1",
      pinned: true,
    }),
  );
  host.message(
    serverFrame({
      type: "host/session-pinned-changed",
      sessionId: "session-live",
      pinned: true,
    }),
  );
  host.message(serverFrame({ type: "host/session-removed", sessionId: "session-a" }));
  host.message(
    serverFrame(
      { type: "host/session-status", sessionId: "invalid-method", running: true },
      "host/session-removed",
    ),
  );
  host.message(
    serverFrame({ type: "host/session-status", sessionId: "invalid-shape", running: "yes" }),
  );

  assert.deepEqual(runningSnapshots, [
    ["session-b"],
    ["session-a", "session-b"],
    ["session-a"],
    [],
  ]);
  assert.deepEqual(hostTypes, [
    "host/session-status",
    "host/session-status",
    "host/session-status",
    "host/session-interaction-status",
    "host/workspace-changed",
    "host/session-changed",
    "host/session-archive-changed",
    "host/workspace-pinned-changed",
    "host/session-pinned-changed",
    "host/session-removed",
  ]);
  assert.equal(mux.sendCalls.length + host.sendCalls.length, 0);
  controller.dispose();
});

test("replaces the running comparison baseline after reconnect revalidation", () => {
  const sockets: FakeSocket[] = [];
  const runningSnapshots: string[][] = [];
  const controller = new PiConnectionController({
    webSocketFactory: (path) => {
      const socket = new FakeSocket(path);
      sockets.push(socket);
      return socket;
    },
  });

  controller.startRunningEvents((sessionIds) => runningSnapshots.push(sessionIds));
  const [mux, host] = socketPair(sockets, 1);
  mux.open();
  host.open();

  host.message(serverFrame({ type: "host/session-status", sessionId: "session-a", running: true }));
  controller.replaceRunningBaseline([]);
  host.message(serverFrame({ type: "host/session-status", sessionId: "session-a", running: true }));

  controller.replaceRunningBaseline(["session-b"]);
  host.message(
    serverFrame({ type: "host/session-status", sessionId: "session-b", running: false }),
  );

  assert.deepEqual(runningSnapshots, [["session-a"], ["session-a"], []]);
  controller.dispose();
});

test("scheduleSessionClose only unregisters the session from the shared sockets", async () => {
  const timers = new FakeTimers();
  const sockets: FakeSocket[] = [];
  const events: PiEvent[] = [];
  const controller = new PiConnectionController({
    webSocketFactory: (path) => {
      const socket = new FakeSocket(path);
      sockets.push(socket);
      return socket;
    },
    timers,
  });

  const connected = controller.ensureSessionEvents("session-1", (event) => events.push(event));
  const [mux, host] = socketPair(sockets, 1);
  mux.open();
  host.open();
  await connected;
  controller.scheduleSessionClose("session-1");
  const idleTimer = timers.pending().find((task) => task.delayMs === 30_000);
  assert.ok(idleTimer);
  idleTimer.cleared = true;
  idleTimer.callback();

  mux.message(serverFrame({ type: "session/subscribed", sessionId: "session-1", lastSeq: 3 }));
  assert.equal(events.length, 0);
  assert.equal(mux.closeCalls.length, 0);
  assert.equal(host.closeCalls.length, 0);
  controller.dispose();
});

test("uses one jittered exponential retry timer when opening a generation fails", () => {
  const timers = new FakeTimers();
  const controller = new PiConnectionController({
    webSocketFactory: () => {
      throw new Error("offline");
    },
    timers,
    random: () => 1,
  });

  controller.startRunningEvents(() => undefined);
  assert.deepEqual(
    timers.pending().map((task) => task.delayMs),
    [250],
  );
  timers.runNext();
  assert.deepEqual(
    timers.pending().map((task) => task.delayMs),
    [500],
  );
  controller.dispose();
  assert.equal(timers.pending().length, 0);
});
