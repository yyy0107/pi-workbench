import assert from "node:assert/strict";
import test from "node:test";

import type { TerminalProcessSnapshot, TerminalServerFrame } from "../contracts";
import {
  createTerminalGateway,
  terminalOptionsForUpgradeUrl,
  type TerminalSessionManagerLike,
  type TerminalWebSocket,
} from "./terminal-gateway";
import type {
  AttachedTerminalSession,
  TerminalSessionClient,
  TerminalSessionSubscription,
} from "./terminal-session-manager";

class FakeWebSocket implements TerminalWebSocket {
  readyState = 1;
  bufferedAmount = 0;
  readonly frames: TerminalServerFrame[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  readonly #listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  send(data: string, callback?: (error?: Error) => void) {
    this.frames.push(JSON.parse(data) as TerminalServerFrame);
    callback?.();
  }

  close(code?: number, reason?: string) {
    this.closes.push({ code, reason });
  }

  on(event: "message" | "close" | "error", listener: (...args: unknown[]) => void) {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
  }

  emit(event: "message" | "close" | "error", ...args: unknown[]) {
    for (const listener of this.#listeners.get(event) ?? []) listener(...args);
  }
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function processSnapshot(
  overrides: Partial<TerminalProcessSnapshot> = {},
): TerminalProcessSnapshot {
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
    outputBytes: 6,
    outputBytesCap: 1024,
    outputCapReached: false,
    ...overrides,
  };
}

test("recognizes and validates terminal upgrade URLs", () => {
  assert.deepEqual(
    terminalOptionsForUpgradeUrl(
      "/api/terminal?sessionId=workspace:one&cwd=%2Fworkspace&cols=120&rows=40&toolCallId=call-1",
    ),
    {
      sessionId: "workspace:one",
      toolCallId: "call-1",
      cwd: "/workspace",
      cols: 120,
      rows: 40,
    },
  );
  assert.equal(terminalOptionsForUpgradeUrl("/_next/webpack-hmr"), undefined);
  assert.equal(terminalOptionsForUpgradeUrl("/api/terminal?sessionId=bad%2Fid"), null);
  assert.equal(terminalOptionsForUpgradeUrl("/api/terminal?sessionId=one&cols=0"), null);
  assert.deepEqual(
    terminalOptionsForUpgradeUrl(
      "/api/terminal?sessionId=workspace:one&toolCallId=call-1&observe=interaction",
    ),
    { sessionId: "workspace:one", toolCallId: "call-1", observe: "interaction" },
  );
  assert.equal(
    terminalOptionsForUpgradeUrl("/api/terminal?sessionId=one&observe=everything"),
    null,
  );
});

test("bridges websocket input, resize, commands, and PTY output", async () => {
  const webSocket = new FakeWebSocket();
  const writes: string[] = [];
  const runs: string[] = [];
  const sizes: Array<{ cols: number; rows: number }> = [];
  let interrupted = 0;
  let terminated = 0;
  let terminalClient: TerminalSessionClient | undefined;
  let detached = false;
  const snapshot = processSnapshot();
  const terminal: AttachedTerminalSession = {
    processHandle: snapshot.processHandle,
    snapshot: () => snapshot,
    subscribe(client): TerminalSessionSubscription {
      terminalClient = client;
      client.onStateChange?.(snapshot);
      return {
        replay: {
          data: "prompt",
          sequence: 1,
          outputBytes: 6,
          outputCapReached: false,
        },
        detach: () => (detached = true),
      };
    },
    writeStdin: (data) => writes.push(data),
    run: (command) => runs.push(command),
    resizePty: (cols, rows) => sizes.push({ cols, rows }),
    interrupt: () => (interrupted += 1),
    terminate: () => (terminated += 1),
  };
  const requests: unknown[] = [];
  const sessions: TerminalSessionManagerLike = {
    async attach(options) {
      requests.push(options);
      return terminal;
    },
  };
  const gateway = createTerminalGateway({
    webSocketServer: {
      handleUpgrade(request, _socket, _head, callback) {
        callback(webSocket, request);
      },
    },
    sessions,
    inspectTrust: () => ({ trusted: true, loopback: true }),
  });
  const upgradeSocket = { write: () => true, destroy: () => true };

  assert.equal(
    gateway.handleUpgrade(
      {
        url: "/api/terminal?sessionId=workspace:one&cwd=%2Fworkspace&cols=80&rows=24",
        headers: { host: "127.0.0.1:3000" },
      },
      upgradeSocket,
      Buffer.alloc(0),
    ),
    true,
  );
  await tick();

  assert.deepEqual(requests, [
    { sessionId: "workspace:one", cwd: "/workspace", cols: 80, rows: 24 },
  ]);
  assert.deepEqual(webSocket.frames.slice(0, 3), [
    { type: "process/ready", process: snapshot },
    {
      type: "process/output-delta",
      delta: {
        processHandle: "workspace:one",
        sequence: 1,
        stream: "terminal",
        data: "prompt",
        outputBytes: 6,
        outputCapReached: false,
      },
    },
    {
      type: "process/state",
      processHandle: "workspace:one",
      processState: "running",
      interactionState: "none",
      attachmentState: "attached",
    },
  ]);

  const frame = (value: unknown) => webSocket.emit("message", Buffer.from(JSON.stringify(value)));
  frame({ type: "process/write-stdin", processHandle: "workspace:one", data: "pwd\r" });
  frame({
    type: "process/resize",
    processHandle: "workspace:one",
    cols: 120,
    rows: 40,
  });
  frame({ type: "process/interrupt", processHandle: "workspace:one" });
  frame({ type: "process/run", processHandle: "workspace:one", command: "pnpm build" });
  frame({ type: "process/terminate", processHandle: "workspace:one" });
  terminalClient?.onOutput({
    processHandle: "workspace:one",
    sequence: 2,
    stream: "terminal",
    data: "live output",
    outputBytes: 17,
    outputCapReached: false,
  });

  assert.deepEqual(writes, ["pwd\r"]);
  assert.deepEqual(sizes, [{ cols: 120, rows: 40 }]);
  assert.deepEqual(runs, ["pnpm build"]);
  assert.equal(interrupted, 1);
  assert.equal(terminated, 1);
  assert.deepEqual(webSocket.frames.at(-1), {
    type: "process/output-delta",
    delta: {
      processHandle: "workspace:one",
      sequence: 2,
      stream: "terminal",
      data: "live output",
      outputBytes: 17,
      outputCapReached: false,
    },
  });

  webSocket.emit("close");
  assert.equal(detached, true);
});

test("streams interaction state without terminal data to read-only observers", async () => {
  const webSocket = new FakeWebSocket();
  let terminalClient: TerminalSessionClient | undefined;
  let snapshot = processSnapshot({
    processHandle: "tool:session-1:call-1",
    sessionId: "session-1",
    kind: "tool",
    interactionState: "possible",
    outputBytes: 20,
  });
  const terminal: AttachedTerminalSession = {
    processHandle: snapshot.processHandle,
    snapshot: () => snapshot,
    subscribe(client) {
      terminalClient = client;
      client.onStateChange?.(snapshot);
      return {
        replay: {
          data: "raw terminal history",
          sequence: 1,
          outputBytes: 20,
          outputCapReached: false,
        },
        detach: () => {},
      };
    },
    writeStdin: () => assert.fail("observer must not write"),
    run: () => assert.fail("observer must not run"),
    resizePty: () => assert.fail("observer must not resize"),
    interrupt: () => assert.fail("observer must not interrupt"),
    terminate: () => assert.fail("observer must not terminate"),
  };
  const gateway = createTerminalGateway({
    webSocketServer: {
      handleUpgrade(request, _socket, _head, callback) {
        callback(webSocket, request);
      },
    },
    sessions: { attach: async () => terminal },
    inspectTrust: () => ({ trusted: true, loopback: true }),
  });

  gateway.handleUpgrade(
    {
      url: "/api/terminal?sessionId=session-1&toolCallId=call-1&observe=interaction",
      headers: { host: "127.0.0.1:3000" },
    },
    { write: () => true, destroy: () => true },
    Buffer.alloc(0),
  );
  await tick();

  assert.deepEqual(webSocket.frames.slice(0, 2), [
    { type: "process/ready", process: snapshot },
    {
      type: "process/state",
      processHandle: "tool:session-1:call-1",
      processState: "running",
      interactionState: "possible",
      attachmentState: "attached",
    },
  ]);
  terminalClient?.onOutput({
    processHandle: snapshot.processHandle,
    sequence: 2,
    stream: "terminal",
    data: "secret raw output",
    outputBytes: 37,
    outputCapReached: false,
  });
  snapshot = { ...snapshot, interactionState: "active" };
  terminalClient?.onStateChange?.(snapshot);
  assert.deepEqual(webSocket.frames.at(-1), {
    type: "process/state",
    processHandle: "tool:session-1:call-1",
    processState: "running",
    interactionState: "active",
    attachmentState: "attached",
  });
  assert.equal(
    webSocket.frames.some((frame) => frame.type === "process/output-delta"),
    false,
  );

  webSocket.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        type: "process/write-stdin",
        processHandle: snapshot.processHandle,
        data: "oops",
      }),
    ),
  );
  assert.deepEqual(webSocket.frames.at(-1), {
    type: "process/error",
    processHandle: snapshot.processHandle,
    code: "invalid-message",
  });
  assert.deepEqual(webSocket.closes.at(-1), {
    code: 1008,
    reason: "interaction observer is read-only",
  });
});

test("rejects untrusted terminal upgrades before accepting a websocket", () => {
  let accepted = false;
  const writes: string[] = [];
  let destroyed = false;
  const gateway = createTerminalGateway({
    webSocketServer: {
      handleUpgrade() {
        accepted = true;
      },
    },
    sessions: { attach: async () => assert.fail("session should not be opened") },
    inspectTrust: () => ({ trusted: false, loopback: false }),
  });

  assert.equal(
    gateway.handleUpgrade(
      { url: "/api/terminal?sessionId=one", headers: { host: "attacker.example" } },
      {
        write: (data) => writes.push(data),
        destroy: () => (destroyed = true),
      },
      Buffer.alloc(0),
    ),
    true,
  );
  assert.equal(accepted, false);
  assert.equal(destroyed, true);
  assert.match(writes[0], /^HTTP\/1\.1 403 Forbidden/);
});
