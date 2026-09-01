import assert from "node:assert/strict";
import test from "node:test";

import {
  createAuthenticatedNoServerWebSocketServer,
  defineDesktopSidecarRuntimeAuthPolicy,
  type RuntimeAuthenticationTimers,
} from "@workbench/host-server/runtime-transport-auth";
import type { TerminalProcessSnapshot } from "@workbench/terminal-contracts";
import {
  createTerminalGateway,
  type TerminalSessionManagerLike,
  type TerminalUpgradeRequest,
  type TerminalUpgradeSocket,
  type TerminalWebSocket,
} from "@workbench/terminal-server/gateway";
import type {
  AttachedTerminalSession,
  TerminalSessionSubscription,
} from "@workbench/terminal-server/shell-sessions";

type SocketEvent = "message" | "close" | "error";
type SocketListener = (...arguments_: unknown[]) => void;

class FakeWebSocket implements TerminalWebSocket {
  readonly readyState = 1;
  readonly bufferedAmount = 0;
  readonly sent: string[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  readonly #onceListeners = new Map<SocketEvent, Set<SocketListener>>();
  readonly #listeners = new Map<SocketEvent, Set<SocketListener>>();
  readonly #sendCallbacks: Array<(error?: Error) => void> = [];

  once(event: SocketEvent, listener: SocketListener): void {
    const listeners = this.#onceListeners.get(event) ?? new Set();
    listeners.add(listener);
    this.#onceListeners.set(event, listeners);
  }

  on(event: SocketEvent, listener: SocketListener): void {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
  }

  off(event: SocketEvent, listener: SocketListener): void {
    this.#onceListeners.get(event)?.delete(listener);
    this.#listeners.get(event)?.delete(listener);
  }

  send(data: string, callback?: (error?: Error) => void): void {
    this.sent.push(data);
    if (callback) this.#sendCallbacks.push(callback);
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }

  emit(event: SocketEvent, ...arguments_: unknown[]): void {
    const listeners = [
      ...(this.#onceListeners.get(event) ?? []),
      ...(this.#listeners.get(event) ?? []),
    ];
    this.#onceListeners.get(event)?.clear();
    for (const listener of listeners) listener(...arguments_);
  }

  completeNextSend(error?: Error): void {
    const callback = this.#sendCallbacks.shift();
    assert.ok(callback, "expected a pending WebSocket send callback");
    callback(error);
  }
}

interface TimerTask {
  callback(): void;
  cleared: boolean;
}

class FakeTimers implements RuntimeAuthenticationTimers {
  readonly tasks: TimerTask[] = [];

  setTimeout(callback: () => void): TimerTask {
    const task = { callback, cleared: false };
    this.tasks.push(task);
    return task;
  }

  clearTimeout(timer: unknown): void {
    (timer as TimerTask).cleared = true;
  }

  runNext(): void {
    const task = this.tasks.find((candidate) => !candidate.cleared);
    assert.ok(task, "expected a pending authentication timer");
    task.cleared = true;
    task.callback();
  }
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function snapshot(): TerminalProcessSnapshot {
  return {
    processHandle: "workspace:one",
    sessionId: "workspace:one",
    kind: "shell",
    cwd: "/workspace",
    process: "bash",
    pid: 42,
    tty: true,
    processState: "running",
    interactionState: "none",
    attachmentState: "attached",
    startedAt: 100,
    outputBytes: 0,
    outputBytesCap: 1024,
    outputCapReached: false,
  };
}

function attachedTerminal(): AttachedTerminalSession {
  const process = snapshot();
  return {
    processHandle: process.processHandle,
    snapshot: () => process,
    subscribe: (): TerminalSessionSubscription => ({
      replay: { data: "", sequence: 0, outputBytes: 0, outputCapReached: false },
      detach: () => {},
    }),
    writeStdin: () => {},
    run: () => {},
    resizePty: () => {},
    interrupt: () => {},
    terminate: () => {},
  };
}

function terminalGatewayWithDesktopAuthentication() {
  const policy = defineDesktopSidecarRuntimeAuthPolicy({
    instanceId: "desktop-one",
    accessToken: "terminal-auth-secret",
    allowedOrigins: ["https://renderer.workbench.test"],
    webSocketAuthenticationTimeoutMs: 25,
  });
  const timers = new FakeTimers();
  const webSocket = new FakeWebSocket();
  const attachments: Array<Parameters<TerminalSessionManagerLike["attach"]>[0]> = [];
  const sessions: TerminalSessionManagerLike = {
    async attach(options) {
      attachments.push(options);
      return attachedTerminal();
    },
  };
  const rawServer = {
    handleUpgrade(
      request: TerminalUpgradeRequest,
      _socket: TerminalUpgradeSocket,
      _head: Buffer,
      callback: (socket: FakeWebSocket, upgradedRequest: TerminalUpgradeRequest) => void,
    ) {
      callback(webSocket, request);
    },
  };
  const authenticatedServer = createAuthenticatedNoServerWebSocketServer({
    webSocketServer: rawServer,
    authPolicy: policy,
    timers,
  });
  const gateway = createTerminalGateway({
    webSocketServer: authenticatedServer,
    sessions,
    inspectTrust: () => ({ trusted: true, loopback: true }),
  });
  const request: TerminalUpgradeRequest = {
    url: "/api/terminal?sessionId=workspace:one",
    headers: { host: "127.0.0.1:43127" },
  };
  const upgradeSocket: TerminalUpgradeSocket = { write: () => true, destroy: () => true };

  assert.equal(gateway.handleUpgrade(request, upgradeSocket, Buffer.alloc(0)), true);
  return { attachments, policy, timers, webSocket };
}

function authenticateFrame(policy: {
  protocolVersion: number;
  instanceId: string;
  accessToken: string;
}) {
  return JSON.stringify({
    type: "authenticate",
    protocolVersion: policy.protocolVersion,
    instanceId: policy.instanceId,
    accessToken: policy.accessToken,
  });
}

test("desktop auth failures cannot allocate a Terminal session or spawn a PTY", () => {
  const missing = terminalGatewayWithDesktopAuthentication();
  assert.equal(missing.attachments.length, 0, "a connection with no first frame is not admitted");
  missing.webSocket.emit("close");
  assert.equal(
    missing.attachments.length,
    0,
    "a closed connection without a first frame is not admitted",
  );

  const invalid = terminalGatewayWithDesktopAuthentication();
  invalid.webSocket.emit("message", Buffer.from("not-json"), false);
  assert.equal(invalid.attachments.length, 0, "an invalid first frame is not admitted");

  const timedOut = terminalGatewayWithDesktopAuthentication();
  timedOut.timers.runNext();
  assert.equal(timedOut.attachments.length, 0, "an authentication timeout is not admitted");
});

test("desktop auth acknowledgement completes before Terminal attaches a session", async () => {
  const composed = terminalGatewayWithDesktopAuthentication();
  composed.webSocket.emit("message", Buffer.from(authenticateFrame(composed.policy)), false);

  assert.equal(composed.attachments.length, 0, "the acknowledgement has not completed yet");
  assert.equal(JSON.parse(composed.webSocket.sent[0] ?? "{}").type, "authenticated");

  composed.webSocket.completeNextSend();
  await tick();

  assert.deepEqual(composed.attachments, [{ sessionId: "workspace:one" }]);
});
