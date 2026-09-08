import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import test from "node:test";
import type { WebSocket } from "ws";

import {
  BROWSER_WEBSOCKET_PATH,
  type BrowserEvent,
  type BrowserServerFrame,
} from "@workbench/browser-contracts";
import { BrowserError } from "@workbench/browser-server";
import {
  createAuthenticatedNoServerWebSocketServer,
  defineDesktopSidecarRuntimeAuthPolicy,
} from "@workbench/host-server/runtime-transport-auth";
import {
  createBrowserGateway,
  MAX_BROWSER_CLIENT_MESSAGE_BYTES,
  type BrowserGatewayOptions,
} from "../src/browser-gateway";

class TestSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  deferWrites = false;
  readonly writeCallbacks: Array<(error?: Error) => void> = [];
  readonly sent: BrowserServerFrame[] = [];
  readonly closes: Array<{ code: number; reason: string }> = [];
  send(data: string, callback?: (error?: Error) => void) {
    this.sent.push(JSON.parse(data) as BrowserServerFrame);
    if (callback && this.deferWrites) this.writeCallbacks.push(callback);
    else callback?.();
  }
  close(code: number, reason: string) {
    this.closes.push({ code, reason });
    this.readyState = 3;
    this.emit("close");
  }
}

function fixture(authenticate = false) {
  const socket = new TestSocket();
  const calls: Array<Parameters<BrowserGatewayOptions["manager"]["handle"]>> = [];
  const subscribers = new Set<(event: BrowserEvent) => void>();
  const manager: BrowserGatewayOptions["manager"] = {
    async handle(...args) {
      calls.push(args);
      if (args[0].type === "screenshot") throw new Error("private-path-and-credential");
      if (args[0].type === "print") throw new BrowserError("browser-permission-denied");
      return { ready: true };
    },
    subscribe(listener) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
  };
  const policy = defineDesktopSidecarRuntimeAuthPolicy({
    instanceId: "browser-test",
    accessToken: "test-browser-token",
    allowedOrigins: ["workbench://app"],
  });
  const rawServer: BrowserGatewayOptions["webSocketServer"] = {
    handleUpgrade(request, _socket, _head, callback) {
      callback(socket as unknown as WebSocket, request);
    },
  };
  const gateway = createBrowserGateway({
    manager,
    webSocketServer: createAuthenticatedNoServerWebSocketServer({
      webSocketServer: rawServer,
      ...(authenticate ? { authPolicy: policy } : {}),
    }),
  });
  const rejected: string[] = [];
  const upgrade = (url = BROWSER_WEBSOCKET_PATH, origin = "http://127.0.0.1:1234") =>
    gateway.handleUpgrade(
      { url, headers: { host: "127.0.0.1:1234", origin } } as IncomingMessage,
      { end: (value: string) => rejected.push(value), destroy() {} } as unknown as Duplex,
      Buffer.alloc(0),
    );
  const message = (value: unknown) =>
    socket.emit("message", Buffer.from(JSON.stringify(value)), false);
  return { calls, manager, subscribers, socket, policy, rejected, upgrade, message };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("browser inputs stay ordered per tab, let other tabs proceed, and discard queued work on disconnect", async () => {
  const connected = fixture();
  const calls: Array<[string, string]> = [];
  let releaseFirst!: () => void;
  let releaseClosing!: () => void;
  connected.manager.handle = async (command, options) => {
    assert.equal(command.type, "input");
    if (command.type !== "input" || command.event.kind !== "key") assert.fail("Expected a key");
    calls.push([command.event.key, options?.source ?? "user"]);
    if (command.event.key === "first")
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    if (command.event.key === "second") throw new BrowserError("browser-permission-denied");
    if (command.event.key === "closing")
      await new Promise<void>((resolve) => {
        releaseClosing = resolve;
      });
    return { key: command.event.key };
  };
  const input = (id: string, sessionId: string, source?: "agent") =>
    connected.message({
      id,
      command: {
        type: "input",
        sessionId,
        event: { kind: "key", type: "keyDown", key: id, code: id },
      },
      ...(source ? { source } : {}),
    });
  connected.upgrade();
  input("first", "tab-a", "agent");
  input("second", "tab-a");
  input("independent", "tab-b");
  await settle();
  assert.deepEqual(calls, [
    ["first", "agent"],
    ["independent", "user"],
  ]);
  assert.deepEqual(connected.socket.sent.at(-1), {
    type: "result",
    id: "independent",
    result: { key: "independent" },
  });
  releaseFirst();
  await settle();
  assert.deepEqual(calls, [
    ["first", "agent"],
    ["independent", "user"],
    ["second", "user"],
  ]);
  assert.deepEqual(connected.socket.sent.at(-1), {
    type: "error",
    id: "second",
    code: "browser-permission-denied",
  });

  input("closing", "tab-a");
  input("discarded", "tab-a");
  await settle();
  connected.socket.close(1000, "done");
  releaseClosing();
  await settle();
  assert.deepEqual(calls.at(-1), ["closing", "user"]);
  assert.equal(calls.length, 4);
  assert.equal(connected.subscribers.size, 0);
});

test("browser backpressure delivers each tab's final frame after drain and bounds pending tabs", () => {
  const connected = fixture();
  connected.socket.deferWrites = true;
  connected.upgrade();
  const publish = (sessionId: string, data: string) => {
    for (const listener of connected.subscribers)
      listener({ type: "frame", sessionId, data, mimeType: "image/png", width: 800, height: 600 });
  };
  publish("first", "initial");
  connected.socket.bufferedAmount = 2 * 1024 * 1024;
  publish("first", "intermediate");
  publish("first", "final");
  publish("second", "other-tab");
  assert.equal(connected.socket.sent.length, 1);
  connected.socket.bufferedAmount = 0;
  // Synchronous callbacks during the flush must not recurse or resend entries.
  connected.socket.deferWrites = false;
  connected.socket.writeCallbacks.shift()!();
  assert.deepEqual(
    connected.socket.sent.map((frame) => frame.type === "frame" && [frame.sessionId, frame.data]),
    [
      ["first", "initial"],
      ["first", "final"],
      ["second", "other-tab"],
    ],
  );

  connected.socket.deferWrites = true;
  publish("first", "before-close");
  connected.socket.bufferedAmount = 2 * 1024 * 1024;
  publish("first", "after-close");
  connected.socket.close(1000, "done");
  connected.socket.bufferedAmount = 0;
  connected.socket.writeCallbacks.shift()!();
  assert.equal(connected.socket.sent.length, 4);
  assert.equal(connected.subscribers.size, 0);

  const bounded = fixture();
  bounded.upgrade();
  bounded.socket.bufferedAmount = 2 * 1024 * 1024;
  for (let index = 0; index < 33; index++)
    for (const listener of bounded.subscribers)
      listener({ type: "frame", sessionId: String(index), data: "png", width: 800, height: 600 });
  assert.equal(bounded.socket.closes[0]?.code, 1013);
  assert.equal(bounded.subscribers.size, 0);
});

test("browser gateway admits only its exact trusted path and validates commands before execution", async () => {
  const blocked = fixture();
  assert.equal(blocked.upgrade("/api/other"), false);
  assert.equal(blocked.upgrade(BROWSER_WEBSOCKET_PATH, "https://attacker.example"), true);
  assert.equal(blocked.upgrade(`${BROWSER_WEBSOCKET_PATH}?token=secret`), true);
  assert.equal(blocked.rejected.length, 2);
  assert.equal(blocked.subscribers.size, 0);

  const invalid = fixture();
  invalid.upgrade();
  invalid.message({ id: "1", method: "Runtime.evaluate", params: { expression: "secret" } });
  await settle();
  assert.equal(invalid.calls.length, 0);
  assert.equal(invalid.socket.closes[0]?.code, 1008);
  assert.equal(invalid.subscribers.size, 0);
});

test("desktop authentication must complete before browser subscriptions or commands are admitted", async () => {
  const denied = fixture(true);
  denied.upgrade();
  denied.message({ id: "before-auth", command: { type: "settings.get" } });
  await settle();
  assert.equal(denied.subscribers.size, 0);
  assert.equal(denied.calls.length, 0);
  assert.equal(denied.socket.closes.length, 1);

  const allowed = fixture(true);
  allowed.upgrade();
  assert.equal(allowed.subscribers.size, 0);
  allowed.message({
    type: "authenticate",
    protocolVersion: allowed.policy.protocolVersion,
    instanceId: allowed.policy.instanceId,
    accessToken: allowed.policy.accessToken,
  });
  assert.equal(allowed.subscribers.size, 1);
  allowed.message({ id: "after-auth", command: { type: "settings.get" } });
  await settle();
  assert.deepEqual(allowed.calls, [[{ type: "settings.get" }, { source: "user" }]]);
  assert.deepEqual(allowed.socket.sent.at(-1), {
    type: "result",
    id: "after-auth",
    result: { ready: true },
  });
  allowed.socket.close(1000, "done");
  assert.equal(allowed.subscribers.size, 0);
});

test("browser ingress rejects binary, oversized, and duplicate pending requests", async () => {
  for (const [raw, binary] of [
    [Buffer.from("{}"), true],
    [Buffer.alloc(MAX_BROWSER_CLIENT_MESSAGE_BYTES + 1), false],
  ] as const) {
    const invalid = fixture();
    invalid.upgrade();
    invalid.socket.emit("message", raw, binary);
    assert.equal(invalid.socket.closes[0]?.code, 1009);
    assert.equal(invalid.calls.length, 0);
    assert.equal(invalid.subscribers.size, 0);
  }

  const duplicate = fixture();
  duplicate.upgrade();
  duplicate.message({ id: "same", command: { type: "settings.get" } });
  duplicate.message({ id: "same", command: { type: "settings.get" } });
  await settle();
  assert.equal(duplicate.socket.closes[0]?.code, 1008);
  assert.equal(duplicate.calls.length, 0);
  assert.equal(duplicate.subscribers.size, 0);
});

test("browser results/events share the connection, agent requests stay downgraded, and errors are sanitized", async () => {
  const connected = fixture();
  connected.upgrade();
  connected.message({ id: "user", command: { type: "settings.get" } });
  connected.message({
    id: "agent",
    source: "agent",
    command: { type: "navigate", sessionId: "tab", url: "https://example.com" },
  });
  connected.message({ id: "internal-error", command: { type: "screenshot", sessionId: "tab" } });
  connected.message({ id: "permission", command: { type: "print", sessionId: "tab" } });
  const event: BrowserEvent = {
    type: "frame",
    sessionId: "tab",
    data: "image",
    width: 640,
    height: 480,
  };
  for (const listener of connected.subscribers) listener(event);
  await settle();
  assert.equal(connected.calls[1]?.[1]?.source, "agent");
  assert.ok(
    connected.socket.sent.some((frame) => frame.type === "frame" && frame.sessionId === "tab"),
  );
  assert.ok(
    connected.socket.sent.some(
      (frame) =>
        frame.type === "error" &&
        "id" in frame &&
        frame.id === "internal-error" &&
        frame.code === "browser-operation-failed",
    ),
  );
  assert.ok(
    connected.socket.sent.some(
      (frame) =>
        frame.type === "error" &&
        "id" in frame &&
        frame.id === "permission" &&
        frame.code === "browser-permission-denied",
    ),
  );
  assert.equal(
    JSON.stringify(connected.socket.sent).includes("private-path-and-credential"),
    false,
  );
  connected.socket.close(1000, "done");
});
