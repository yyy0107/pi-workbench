import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_CONNECTION_PROTOCOL_VERSION,
  defineRuntimeConnection,
} from "@workbench/host-contracts";
import {
  createRuntimeWebSocket,
  RuntimeWebSocketReadyState,
  type RuntimeWebSocket,
  type RuntimeWebSocketMessageEvent,
} from "@workbench/host-client";

import {
  isInvalidTerminalSessionClose,
  isTerminalSocketWritable,
  terminalReconnectDelay,
} from "../src/terminal-client-connection";

class FakeWebSocket implements RuntimeWebSocket {
  readyState: number = RuntimeWebSocketReadyState.connecting;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: RuntimeWebSocketMessageEvent) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  readonly sent: unknown[] = [];

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = RuntimeWebSocketReadyState.closing;
  }

  open(): void {
    this.readyState = RuntimeWebSocketReadyState.open;
    this.onopen?.({ type: "open" });
  }

  message(data: unknown): void {
    this.onmessage?.({ data });
  }
}

test("keeps Terminal unwritable until Runtime auth and process readiness both complete", () => {
  const connection = defineRuntimeConnection({
    kind: "desktop-sidecar",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    httpOrigin: "http://127.0.0.1:43123",
    instanceId: "runtime-terminal",
    accessToken: "terminal-secret",
  });
  if (connection.kind !== "desktop-sidecar") throw new Error("Expected a sidecar connection.");
  let raw: FakeWebSocket | undefined;
  const socket = createRuntimeWebSocket(connection, "/api/terminal?sessionId=terminal-a", {
    webSocketFactory: () => (raw = new FakeWebSocket()),
  });

  raw!.open();
  assert.equal(socket.readyState, RuntimeWebSocketReadyState.connecting);
  assert.equal(isTerminalSocketWritable(socket, false), false);
  raw!.message(
    JSON.stringify({
      type: "authenticated",
      protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
      instanceId: connection.instanceId,
    }),
  );
  assert.equal(socket.readyState, RuntimeWebSocketReadyState.open);
  assert.equal(isTerminalSocketWritable(socket, false), false);
  assert.equal(isTerminalSocketWritable(socket, true), true);
});

test("preserves bounded reconnect policy and treats auth failures as reconnectable", () => {
  assert.equal(terminalReconnectDelay(1, { baseMs: 250, maxMs: 10_000, exponentCap: 6 }), 500);
  assert.equal(terminalReconnectDelay(99, { baseMs: 250, maxMs: 10_000, exponentCap: 6 }), 10_000);
  assert.equal(isInvalidTerminalSessionClose({ code: 1008 }), true);
  assert.equal(isInvalidTerminalSessionClose({ code: 4401 }), false);
});
