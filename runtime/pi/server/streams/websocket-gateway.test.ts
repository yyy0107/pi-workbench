import assert from "node:assert/strict";
import test from "node:test";

import type { ServerRequest } from "@/runtime/pi/contracts/stream";
import type { DownlinkWebSocket, UpgradeRequestLike, UpgradeSocketLike } from "./websocket-gateway";

const { acceptDownlinkWebSocket, createNoServerWebSocketGateway, streamNameForUpgradeUrl } =
  (await import(
    new URL("./websocket-gateway.ts", import.meta.url).href
  )) as typeof import("./websocket-gateway");
const { createStreamHub } = (await import(
  new URL("./stream-hub.ts", import.meta.url).href
)) as typeof import("./stream-hub");

class FakeWebSocket implements DownlinkWebSocket {
  readyState = 1;
  bufferedAmount = 0;
  autoCompleteSends = true;
  readonly sent: string[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  private readonly sendCallbacks: Array<{
    byteLength: number;
    callback?: (error?: Error) => void;
  }> = [];
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  send(data: string, callback?: (error?: Error) => void): void {
    this.sent.push(data);
    if (this.autoCompleteSends) {
      callback?.();
      return;
    }
    const dataBytes = Buffer.byteLength(data, "utf8");
    this.bufferedAmount += dataBytes;
    this.sendCallbacks.push({ byteLength: dataBytes, callback });
  }

  completeNextSend(error?: Error): void {
    const pending = this.sendCallbacks.shift();
    assert.ok(pending, "expected an in-flight WebSocket send");
    this.bufferedAmount -= pending.byteLength;
    pending.callback?.(error);
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
    this.readyState = 3;
    this.emit("close", code, reason);
  }

  on(event: "message" | "close" | "error", listener: (...args: unknown[]) => void): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  emit(event: "message" | "close" | "error", ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

class FakeUpgradeSocket implements UpgradeSocketLike {
  readonly writes: string[] = [];
  destroyed = false;

  write(data: string): void {
    this.writes.push(data);
  }

  destroy(): void {
    this.destroyed = true;
  }
}

interface FakeUpgradeRequest extends UpgradeRequestLike {
  url: string;
}

test("serializes exact ServerRequest frames and rejects all client messages", async () => {
  const hub = createStreamHub({ createRpcId: () => "rpc-frame" });
  const socket = new FakeWebSocket();
  const connection = acceptDownlinkWebSocket("host", socket, { hub });
  await connection.ready;

  hub.publishHost({ type: "host/session-status", sessionId: "session-1", running: true });
  const frame = JSON.parse(socket.sent[0] ?? "null") as ServerRequest;
  assert.deepEqual(frame, {
    type: "server-request",
    rpcId: "rpc-frame",
    method: "host/session-status",
    payload: { type: "host/session-status", sessionId: "session-1", running: true },
  });

  socket.emit("message", "client data");
  assert.deepEqual(socket.closes.at(-1), { code: 1008, reason: "downlink only" });
});

test("sends stream/error best-effort and closes 1011 when a source fails", async () => {
  let nextId = 0;
  const hub = createStreamHub({ createRpcId: () => `event-${++nextId}` });
  const socket = new FakeWebSocket();
  const connection = acceptDownlinkWebSocket("mux", socket, {
    hub,
    createRpcId: () => "error-rpc",
  });
  await connection.ready;

  hub.fail("mux", new Error("source stopped"));

  const diagnostic = JSON.parse(socket.sent[0] ?? "null") as ServerRequest;
  assert.equal(diagnostic.method, "stream/error");
  assert.equal(diagnostic.payload.type, "stream/error");
  assert.equal(diagnostic.rpcId, "error-rpc");
  assert.deepEqual(socket.closes.at(-1), { code: 1011, reason: "stream error" });
});

test("allows a healthy socket to send a frame larger than the backlog budget", async () => {
  const hub = createStreamHub({ createRpcId: () => "rpc-slow" });
  const socket = new FakeWebSocket();
  const connection = acceptDownlinkWebSocket("host", socket, {
    hub,
    maxBufferedBytes: 64,
  });
  await connection.ready;

  hub.publishHost({ type: "host/session-removed", sessionId: "session-1" });
  assert.equal(socket.sent.length, 1);
  assert.equal(Buffer.byteLength(socket.sent[0] ?? "", "utf8") > 64, true);
  assert.equal(socket.closes.length, 0);
});

test("serializes writes and closes a client whose pending frame backlog stays over budget", async () => {
  const hub = createStreamHub({ createRpcId: () => "rpc-slow" });
  const socket = new FakeWebSocket();
  socket.autoCompleteSends = false;
  const connection = acceptDownlinkWebSocket("host", socket, {
    hub,
    maxBufferedBytes: 160,
  });
  await connection.ready;

  hub.publishHost({ type: "host/session-removed", sessionId: "session-1" });
  hub.publishHost({ type: "host/session-removed", sessionId: "session-2" });
  assert.equal(socket.sent.length, 1);

  hub.publishHost({ type: "host/session-removed", sessionId: "session-3" });
  assert.equal(socket.sent.length, 1);
  assert.deepEqual(socket.closes.at(-1), { code: 1011, reason: "stream error" });
});

test("drains queued frames in publication order after each write completes", async () => {
  let nextId = 0;
  const hub = createStreamHub({ createRpcId: () => `rpc-${++nextId}` });
  const socket = new FakeWebSocket();
  socket.autoCompleteSends = false;
  const connection = acceptDownlinkWebSocket("host", socket, {
    hub,
    maxBufferedBytes: 1024,
  });
  await connection.ready;

  hub.publishHost({ type: "host/session-removed", sessionId: "session-1" });
  hub.publishHost({ type: "host/session-removed", sessionId: "session-2" });
  assert.equal(socket.sent.length, 1);

  socket.completeNextSend();
  assert.equal(socket.sent.length, 2);
  assert.deepEqual(
    socket.sent.map((data) => (JSON.parse(data) as ServerRequest).payload),
    [
      { type: "host/session-removed", sessionId: "session-1" },
      { type: "host/session-removed", sessionId: "session-2" },
    ],
  );
  assert.equal(socket.closes.length, 0);
});

test("maps only the two exact websocket paths", () => {
  assert.equal(streamNameForUpgradeUrl("/api/events.mux"), "mux");
  assert.equal(streamNameForUpgradeUrl("/api/events.host?generation=2"), "host");
  assert.equal(streamNameForUpgradeUrl("/api/events.mux/extra"), undefined);
  assert.equal(streamNameForUpgradeUrl("/api/session.list"), undefined);
});

test("applies the shared trust policy before delegating a noServer upgrade", async () => {
  const hub = createStreamHub({ createRpcId: () => "rpc-upgrade" });
  const upgraded: FakeUpgradeRequest[] = [];
  const acceptedSocket = new FakeWebSocket();
  const webSocketServer = {
    handleUpgrade(
      request: FakeUpgradeRequest,
      _socket: FakeUpgradeSocket,
      _head: Uint8Array,
      callback: (socket: DownlinkWebSocket, request: FakeUpgradeRequest) => void,
    ) {
      upgraded.push(request);
      callback(acceptedSocket, request);
    },
  };
  const gateway = createNoServerWebSocketGateway({
    webSocketServer,
    hub,
    trustedHosts: ["workbench.example:3080"],
  });

  const rejectedSocket = new FakeUpgradeSocket();
  assert.equal(
    gateway.handleUpgrade(
      { url: "/api/events.host", headers: { host: "evil.example:3080" } },
      rejectedSocket,
      new Uint8Array(),
    ),
    true,
  );
  assert.match(rejectedSocket.writes[0] ?? "", /^HTTP\/1\.1 403 Forbidden/);
  assert.equal(rejectedSocket.destroyed, true);
  assert.equal(upgraded.length, 0);

  const trustedSocket = new FakeUpgradeSocket();
  assert.equal(
    gateway.handleUpgrade(
      {
        url: "/api/events.host",
        headers: {
          host: "workbench.example:3080",
          origin: "http://workbench.example:3080",
        },
      },
      trustedSocket,
      new Uint8Array(),
    ),
    true,
  );
  assert.equal(upgraded.length, 1);
  assert.equal(trustedSocket.destroyed, false);

  assert.equal(
    gateway.handleUpgrade(
      { url: "/api/not-websocket", headers: { host: "127.0.0.1:3080" } },
      new FakeUpgradeSocket(),
      new Uint8Array(),
    ),
    false,
  );
  await Promise.resolve();
});

test("allows an injected handshake trust inspector", () => {
  let inspected = false;
  const gateway = createNoServerWebSocketGateway({
    webSocketServer: {
      handleUpgrade(
        request: FakeUpgradeRequest,
        _socket: FakeUpgradeSocket,
        _head: Uint8Array,
        callback: (socket: DownlinkWebSocket, request: FakeUpgradeRequest) => void,
      ) {
        callback(new FakeWebSocket(), request);
      },
    },
    hub: createStreamHub(),
    inspectTrust: () => {
      inspected = true;
      return { trusted: true, loopback: false };
    },
  });

  const handled = gateway.handleUpgrade(
    { url: "/api/events.mux", headers: { host: "remote.example" } },
    new FakeUpgradeSocket(),
    new Uint8Array(),
  );
  assert.equal(handled, true);
  assert.equal(inspected, true);
});
