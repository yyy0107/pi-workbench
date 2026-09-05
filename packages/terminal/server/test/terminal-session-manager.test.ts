import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  TerminalSessionError,
  TerminalSessionManager,
  type TerminalExitEvent,
  type TerminalPty,
} from "../src/terminal-session-manager";

class FakePty implements TerminalPty {
  readonly pid = 42;
  readonly process = "bash";
  readonly writes: string[] = [];
  readonly sizes: Array<{ cols: number; rows: number }> = [];
  killed = false;
  readonly #dataListeners = new Set<(data: string) => void>();
  readonly #exitListeners = new Set<(event: TerminalExitEvent) => void>();

  onData(listener: (data: string) => void) {
    this.#dataListeners.add(listener);
    return { dispose: () => this.#dataListeners.delete(listener) };
  }

  onExit(listener: (event: TerminalExitEvent) => void) {
    this.#exitListeners.add(listener);
    return { dispose: () => this.#exitListeners.delete(listener) };
  }

  write(data: string) {
    this.writes.push(data);
  }

  resize(cols: number, rows: number) {
    this.sizes.push({ cols, rows });
  }

  kill() {
    this.killed = true;
  }

  emitData(data: string) {
    for (const listener of this.#dataListeners) listener(data);
  }

  emitExit(event: TerminalExitEvent) {
    for (const listener of this.#exitListeners) listener(event);
  }
}

test("keeps a PTY alive across clients and replays bounded output", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "workbench-terminal-"));
  const terminals: FakePty[] = [];
  const manager = new TerminalSessionManager({
    defaultCwd: cwd,
    idleTimeoutMs: 60_000,
    maxHistoryBytes: 10,
    spawnPty: () => {
      const terminal = new FakePty();
      terminals.push(terminal);
      return terminal;
    },
  });

  try {
    const first = await manager.attach({ sessionId: "workspace-1", cols: 80, rows: 24 });
    const received: string[] = [];
    const subscription = first.subscribe({
      onOutput: (delta) => received.push(delta.data),
      onExit: () => {},
    });
    assert.equal(subscription.replay.data, "");
    assert.equal(first.snapshot().processHandle, "workspace-1");
    assert.equal(first.snapshot().processState, "running");
    assert.equal(first.snapshot().tty, true);

    terminals[0].emitData("hello");
    terminals[0].emitData(" world");
    assert.deepEqual(received, ["hello", " world"]);
    first.writeStdin("pwd\r");
    first.run("pnpm build");
    first.run("printf done\n");
    first.resizePty(120, 40);
    assert.deepEqual(terminals[0].writes, ["pwd\r", "pnpm build\r", "printf done\r"]);
    assert.deepEqual(terminals[0].sizes, [{ cols: 120, rows: 40 }]);
    subscription.detach();

    const second = await manager.attach({ sessionId: "workspace-1" });
    const replay = second.subscribe({ onOutput: () => {}, onExit: () => {} });
    assert.equal(replay.replay.data, " world");
    assert.equal(replay.replay.outputBytes, 11);
    assert.equal(replay.replay.outputCapReached, true);
    assert.equal(terminals.length, 1);
    replay.detach();
  } finally {
    manager.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("uses the desktop-selected shell for integrated terminals", async () => {
  let shell = "";
  const manager = new TerminalSessionManager({
    env: {
      PI_WORKBENCH_TERMINAL_SHELL: "cmd.exe",
      WORKBENCH_TERMINAL_SHELL: "powershell.exe",
    },
    platform: "win32",
    canonicalizeDirectory: async () => "C:\\workspace",
    spawnPty: (file) => {
      shell = file;
      return new FakePty();
    },
  });

  await manager.attach({ sessionId: "desktop-shell", cwd: "C:\\workspace" });
  assert.equal(shell, "cmd.exe");
  manager.dispose();
});

test("rejects a session id reused for another working directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "workbench-terminal-"));
  const other = join(root, "other");
  await mkdir(other);
  const manager = new TerminalSessionManager({
    defaultCwd: root,
    spawnPty: () => new FakePty(),
  });

  try {
    await manager.attach({ sessionId: "workspace-1", cwd: root });
    await assert.rejects(
      manager.attach({ sessionId: "workspace-1", cwd: other }),
      (error: unknown) =>
        error instanceof TerminalSessionError && error.code === "session-conflict",
    );
  } finally {
    manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps multiple terminal instance PTYs independent in one conversation directory", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "workbench-terminal-"));
  const terminals: FakePty[] = [];
  const manager = new TerminalSessionManager({
    defaultCwd: cwd,
    spawnPty: () => {
      const terminal = new FakePty();
      terminals.push(terminal);
      return terminal;
    },
  });

  try {
    const first = await manager.attach({ sessionId: "terminal:thread-1:one" });
    const second = await manager.attach({ sessionId: "terminal:thread-1:two" });

    first.writeStdin("first\r");
    second.writeStdin("second\r");

    assert.equal(terminals.length, 2);
    assert.deepEqual(terminals[0]?.writes, ["first\r"]);
    assert.deepEqual(terminals[1]?.writes, ["second\r"]);
  } finally {
    manager.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("dispose closes admission while terminal directory canonicalization is pending", async () => {
  let canonicalizationStarted!: () => void;
  const started = new Promise<void>((resolve) => (canonicalizationStarted = resolve));
  let releaseCanonicalization!: (cwd: string) => void;
  const canonicalized = new Promise<string>((resolve) => (releaseCanonicalization = resolve));
  let spawnCount = 0;
  const manager = new TerminalSessionManager({
    canonicalizeDirectory: () => {
      canonicalizationStarted();
      return canonicalized;
    },
    spawnPty: () => {
      spawnCount += 1;
      return new FakePty();
    },
  });

  const attaching = manager.attach({ sessionId: "workspace-shutdown", cwd: "/workspace" });
  await started;
  manager.dispose();
  releaseCanonicalization("/workspace");

  await assert.rejects(
    attaching,
    (error: unknown) =>
      error instanceof TerminalSessionError &&
      error.code === "invalid-session" &&
      error.message === "Terminal session manager is disposed.",
  );
  assert.equal(spawnCount, 0);
  await assert.rejects(
    manager.attach({ sessionId: "workspace-after-shutdown", cwd: "/workspace" }),
    (error: unknown) =>
      error instanceof TerminalSessionError &&
      error.code === "invalid-session" &&
      error.message === "Terminal session manager is disposed.",
  );
  manager.dispose();
});

test("a synchronous dispose inside the interactive PTY spawner kills the unowned PTY", async () => {
  const terminal = new FakePty();
  let manager!: TerminalSessionManager;
  manager = new TerminalSessionManager({
    canonicalizeDirectory: async () => "/workspace",
    spawnPty: () => {
      manager.dispose();
      return terminal;
    },
  });

  await assert.rejects(
    manager.attach({ sessionId: "workspace-reentrant", cwd: "/workspace" }),
    (error: unknown) =>
      error instanceof TerminalSessionError &&
      error.code === "invalid-session" &&
      error.message === "Terminal session manager is disposed.",
  );
  assert.equal(terminal.killed, true);
  await assert.rejects(
    manager.attach({ sessionId: "workspace-after-reentrant", cwd: "/workspace" }),
    (error: unknown) => error instanceof TerminalSessionError && error.code === "invalid-session",
  );
});
