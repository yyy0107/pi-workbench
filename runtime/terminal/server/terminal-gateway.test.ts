import assert from "node:assert/strict";
import test from "node:test";

import type { TerminalServerFrame } from "../contracts";
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
});

test("bridges websocket input, resize, commands, and PTY output", async () => {
  const webSocket = new FakeWebSocket();
  const writes: string[] = [];
  const runs: string[] = [];
  const sizes: Array<{ cols: number; rows: number }> = [];
  let interrupted = 0;
  let terminalClient: TerminalSessionClient | undefined;
  let detached = false;
  const terminal: AttachedTerminalSession = {
    sessionId: "workspace:one",
    cwd: "/workspace",
    process: "bash",
    pid: 42,
    subscribe(client): TerminalSessionSubscription {
      terminalClient = client;
      return { history: "prompt", detach: () => (detached = true) };
    },
    write: (data) => writes.push(data),
    run: (command) => runs.push(command),
    resize: (cols, rows) => sizes.push({ cols, rows }),
    interrupt: () => (interrupted += 1),
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
  assert.deepEqual(webSocket.frames.slice(0, 2), [
    {
      type: "ready",
      sessionId: "workspace:one",
      cwd: "/workspace",
      process: "bash",
      pid: 42,
    },
    { type: "data", data: "prompt" },
  ]);

  webSocket.emit("message", Buffer.from(JSON.stringify({ type: "input", data: "pwd\r" })));
  webSocket.emit("message", Buffer.from(JSON.stringify({ type: "resize", cols: 120, rows: 40 })));
  webSocket.emit("message", Buffer.from(JSON.stringify({ type: "interrupt" })));
  webSocket.emit("message", Buffer.from(JSON.stringify({ type: "run", command: "pnpm build" })));
  terminalClient?.onData("live output");

  assert.deepEqual(writes, ["pwd\r"]);
  assert.deepEqual(sizes, [{ cols: 120, rows: 40 }]);
  assert.deepEqual(runs, ["pnpm build"]);
  assert.equal(interrupted, 1);
  assert.deepEqual(webSocket.frames.at(-1), { type: "data", data: "live output" });

  webSocket.emit("close");
  assert.equal(detached, true);
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
