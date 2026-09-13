import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_CONNECTION_PROTOCOL_VERSION,
  RuntimeWebSocketCloseCode,
  defineRuntimeConnection,
  type DesktopSidecarRuntimeConnection,
} from "@workbench/host-contracts";
import {
  createRuntimeWebSocket,
  createRuntimeWebSocketFactory,
  RuntimeWebSocketReadyState,
  type RuntimeWebSocket,
  type RuntimeWebSocketAuthenticationErrorEvent,
  type RuntimeWebSocketMessageEvent,
  type RuntimeWebSocketTimers,
} from "../src/runtime-websocket";

class FakeWebSocket implements RuntimeWebSocket {
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: RuntimeWebSocketMessageEvent) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  readonly sendCalls: unknown[] = [];
  readonly url: string;

  constructor(url: string) {
    this.url = url;
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
    this.onopen?.({ type: "open" });
  }

  message(data: unknown): void {
    this.onmessage?.({ data });
  }

  error(): void {
    this.onerror?.({ type: "error" });
  }

  remoteClose(): void {
    this.readyState = 3;
    this.onclose?.({ type: "close" });
  }
}

interface TimerTask {
  readonly id: number;
  readonly callback: () => void;
  readonly delayMs: number;
  cleared: boolean;
}

class FakeTimers implements RuntimeWebSocketTimers {
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

  runNext(): TimerTask {
    const task = this.tasks.find((candidate) => !candidate.cleared);
    assert.ok(task, "expected a pending timer");
    task.cleared = true;
    task.callback();
    return task;
  }
}

function desktopSidecar(
  port = 43127,
  instanceId = "runtime-1",
  accessToken = "desktop-secret-token",
): DesktopSidecarRuntimeConnection {
  const connection = defineRuntimeConnection({
    kind: "desktop-sidecar",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    httpOrigin: `http://127.0.0.1:${port}`,
    instanceId,
    accessToken,
  });
  if (connection.kind !== "desktop-sidecar")
    throw new Error("Expected desktop-sidecar connection.");
  return connection;
}

const sameOrigin = defineRuntimeConnection({
  kind: "same-origin",
  protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
  httpOrigin: "https://workbench.example.test",
});

function authenticatedFrame(connection: DesktopSidecarRuntimeConnection): string {
  return JSON.stringify({
    type: "authenticated",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    instanceId: connection.instanceId,
  });
}

test("desktop WebSockets authenticate before exposing open or business messages", () => {
  const rawSockets: FakeWebSocket[] = [];
  const timers = new FakeTimers();
  const connection = desktopSidecar();
  const socket = createRuntimeWebSocket(connection, "/api/pi/events", {
    timers,
    webSocketFactory: (url) => {
      const raw = new FakeWebSocket(url);
      rawSockets.push(raw);
      return raw;
    },
  });
  const raw = rawSockets[0]!;
  const opened: unknown[] = [];
  const messages: unknown[] = [];
  socket.onopen = (event) => opened.push(event);
  socket.onmessage = (event) => messages.push(event.data);

  assert.equal(raw.url, "ws://127.0.0.1:43127/api/pi/events");
  assert.equal(raw.url.includes(connection.accessToken), false);
  assert.equal(socket.readyState, RuntimeWebSocketReadyState.connecting);
  assert.throws(() => socket.send("business frame"), /authentication has not completed/);

  raw.open();
  assert.equal(
    socket.readyState,
    RuntimeWebSocketReadyState.connecting,
    "a raw OPEN socket remains logically CONNECTING until the auth acknowledgement",
  );
  assert.equal(opened.length, 0);
  assert.equal(messages.length, 0);
  assert.deepEqual(JSON.parse(String(raw.sendCalls[0])), {
    type: "authenticate",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    instanceId: connection.instanceId,
    accessToken: connection.accessToken,
  });
  assert.equal(timers.tasks[0]?.delayMs, 5_000);

  raw.message(authenticatedFrame(connection));
  assert.equal(socket.readyState, RuntimeWebSocketReadyState.open);
  assert.equal(opened.length, 1);
  assert.equal(messages.length, 0, "the control acknowledgement must stay private");
  assert.equal(timers.tasks[0]?.cleared, true);

  raw.message("business frame");
  socket.send("outbound business frame");
  assert.deepEqual(messages, ["business frame"]);
  assert.deepEqual(raw.sendCalls.slice(1), ["outbound business frame"]);
});

test("desktop authentication timeout reports a credential-safe stable close code", () => {
  const timers = new FakeTimers();
  const connection = desktopSidecar();
  let raw: FakeWebSocket | undefined;
  const socket = createRuntimeWebSocket(connection, "/api/pi/events", {
    timers,
    authenticationTimeoutMs: 17,
    webSocketFactory: (url) => (raw = new FakeWebSocket(url)),
  });
  const errors: RuntimeWebSocketAuthenticationErrorEvent[] = [];
  socket.onerror = (event) => errors.push(event as RuntimeWebSocketAuthenticationErrorEvent);
  raw!.open();

  const timer = timers.runNext();
  assert.equal(timer.delayMs, 17);
  assert.deepEqual(errors, [
    {
      type: "runtime-websocket-authentication-error",
      code: RuntimeWebSocketCloseCode.authenticationTimeout,
    },
  ]);
  assert.deepEqual(raw!.closeCalls, [
    {
      code: RuntimeWebSocketCloseCode.authenticationTimeout,
      reason: "Runtime WebSocket authentication timed out.",
    },
  ]);
  assert.equal(socket.readyState, RuntimeWebSocketReadyState.closing);
  raw!.remoteClose();
  assert.equal(socket.readyState, RuntimeWebSocketReadyState.closed);
  assert.equal(
    JSON.stringify({ errors, closeCalls: raw!.closeCalls }).includes(connection.accessToken),
    false,
  );
  assert.throws(() => socket.send("business frame"), /authentication has not completed/);
});

test("desktop authentication maps invalid, error, version, and instance frames to stable close codes", () => {
  const cases: Array<{
    readonly name: string;
    readonly frame: (connection: DesktopSidecarRuntimeConnection) => string;
    readonly closeCode: RuntimeWebSocketCloseCode;
  }> = [
    {
      name: "invalid frame",
      frame: () => JSON.stringify({ type: "business-before-authentication" }),
      closeCode: RuntimeWebSocketCloseCode.invalidAuthenticationFrame,
    },
    {
      name: "authentication error frame",
      frame: () =>
        JSON.stringify({
          type: "error",
          protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
          code: "authentication-failed",
          message: "Credential rejected.",
        }),
      closeCode: RuntimeWebSocketCloseCode.authenticationFailed,
    },
    {
      name: "protocol mismatch acknowledgement",
      frame: (connection) =>
        JSON.stringify({
          type: "authenticated",
          protocolVersion: connection.protocolVersion + 1,
          instanceId: connection.instanceId,
        }),
      closeCode: RuntimeWebSocketCloseCode.protocolVersionMismatch,
    },
    {
      name: "instance mismatch acknowledgement",
      frame: (connection) =>
        JSON.stringify({
          type: "authenticated",
          protocolVersion: connection.protocolVersion,
          instanceId: `${connection.instanceId}-other`,
        }),
      closeCode: RuntimeWebSocketCloseCode.authenticationFailed,
    },
  ];

  for (const scenario of cases) {
    const connection = desktopSidecar();
    let raw: FakeWebSocket | undefined;
    const socket = createRuntimeWebSocket(connection, "/api/pi/events", {
      webSocketFactory: (url) => (raw = new FakeWebSocket(url)),
    });
    const errors: RuntimeWebSocketAuthenticationErrorEvent[] = [];
    const messages: unknown[] = [];
    socket.onerror = (event) => errors.push(event as RuntimeWebSocketAuthenticationErrorEvent);
    socket.onmessage = (event) => messages.push(event.data);

    raw!.open();
    raw!.message(scenario.frame(connection));

    assert.equal(raw!.closeCalls[0]?.code, scenario.closeCode, scenario.name);
    assert.equal(errors[0]?.code, scenario.closeCode, scenario.name);
    assert.deepEqual(messages, [], scenario.name);
    assert.equal(
      JSON.stringify({ errors, closeCalls: raw!.closeCalls }).includes(connection.accessToken),
      false,
      scenario.name,
    );
  }
});

test("separate desktop connection factories do not share tokens, instances, or authentication state", () => {
  const first = desktopSidecar(43127, "runtime-one", "secret-one");
  const second = desktopSidecar(43128, "runtime-two", "secret-two");
  const firstRaw: FakeWebSocket[] = [];
  const secondRaw: FakeWebSocket[] = [];
  const firstFactory = createRuntimeWebSocketFactory(first, {
    webSocketFactory: (url) => {
      const raw = new FakeWebSocket(url);
      firstRaw.push(raw);
      return raw;
    },
  });
  const secondFactory = createRuntimeWebSocketFactory(second, {
    webSocketFactory: (url) => {
      const raw = new FakeWebSocket(url);
      secondRaw.push(raw);
      return raw;
    },
  });
  const firstSocket = firstFactory("/api/pi/mux");
  const secondSocket = secondFactory("/api/pi/mux");
  const messages: unknown[] = [];
  firstSocket.onmessage = (event) => messages.push(["first", event.data]);
  secondSocket.onmessage = (event) => messages.push(["second", event.data]);

  firstRaw[0]!.open();
  secondRaw[0]!.open();
  assert.equal(firstRaw[0]!.url, "ws://127.0.0.1:43127/api/pi/mux");
  assert.equal(secondRaw[0]!.url, "ws://127.0.0.1:43128/api/pi/mux");
  assert.equal(String(firstRaw[0]!.sendCalls[0]).includes(second.accessToken), false);
  assert.equal(String(secondRaw[0]!.sendCalls[0]).includes(first.accessToken), false);

  firstRaw[0]!.message(authenticatedFrame(first));
  secondRaw[0]!.message(authenticatedFrame(second));
  firstRaw[0]!.message("first message");
  secondRaw[0]!.message("second message");
  assert.deepEqual(messages, [
    ["first", "first message"],
    ["second", "second message"],
  ]);
});

test("same-origin WebSockets preserve the native socket behavior and send no authentication frame", () => {
  let raw: FakeWebSocket | undefined;
  const socket = createRuntimeWebSocket(sameOrigin, "/api/pi/events", {
    webSocketFactory: (url) => (raw = new FakeWebSocket(url)),
  });
  assert.equal(socket, raw);
  assert.equal(raw!.url, "wss://workbench.example.test/api/pi/events");
  const opened: unknown[] = [];
  const messages: unknown[] = [];
  socket.onopen = (event) => opened.push(event);
  socket.onmessage = (event) => messages.push(event.data);

  raw!.open();
  raw!.message("native business frame");
  socket.send("native outbound frame");

  assert.equal(opened.length, 1);
  assert.deepEqual(messages, ["native business frame"]);
  assert.deepEqual(raw!.sendCalls, ["native outbound frame"]);
});

test("rejects invalid desktop authentication configuration before creating a native socket", () => {
  const connection = desktopSidecar();
  let factoryCalls = 0;
  const webSocketFactory = (url: string) => {
    factoryCalls += 1;
    return new FakeWebSocket(url);
  };

  assert.throws(
    () =>
      createRuntimeWebSocket(connection, "/api/events.host", {
        authenticationTimeoutMs: 0,
        webSocketFactory,
      }),
    /timeout must be an integer from 1 to 30000 ms/,
  );
  assert.equal(factoryCalls, 0);

  assert.throws(
    () =>
      createRuntimeWebSocket(connection, "/api/events.host", {
        authenticationTimeoutMs: 30_001,
        webSocketFactory,
      }),
    /timeout must be an integer from 1 to 30000 ms/,
  );
  assert.equal(factoryCalls, 0);

  assert.throws(
    () =>
      createRuntimeWebSocket(connection, "/api/events.host", {
        timers: {} as RuntimeWebSocketTimers,
        webSocketFactory,
      }),
    /authentication timers are invalid/,
  );
  assert.equal(factoryCalls, 0);

  const sameOriginSocket = createRuntimeWebSocket(sameOrigin, "/api/events.host", {
    authenticationTimeoutMs: 0,
    timers: {} as RuntimeWebSocketTimers,
    webSocketFactory,
  });
  assert.equal(factoryCalls, 1);
  assert.ok(sameOriginSocket instanceof FakeWebSocket);
});
