import assert from "node:assert/strict";
import test from "node:test";

import {
  ToolTerminalSessionManager,
  type ToolTerminalExecutionOptions,
} from "../src/tool-terminal-session-manager";
import type { TerminalProcessExit } from "@workbench/terminal-contracts";
import type { TerminalExitEvent, TerminalPty } from "../src/terminal-session-manager";

class FakePty implements TerminalPty {
  readonly pid = 73;
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

test("registers a stable process handle before the tool process exits", async () => {
  const terminal = new FakePty();
  const manager = new ToolTerminalSessionManager({
    retentionMs: 60_000,
    spawnPty: () => terminal,
    terminatePty: (target) => target.kill(),
  });
  const spawned = manager.spawn({
    sessionId: "session-1",
    toolCallId: "call-spawn",
    command: "read answer",
    cwd: "/workspace",
    onData: () => {},
  });
  let completed = false;
  void spawned.completion.finally(() => {
    completed = true;
  });

  assert.equal(spawned.processHandle, "tool:session-1:call-spawn");
  assert.equal(spawned.pid, terminal.pid);
  assert.equal(completed, false);

  const attached = await manager.attach({ sessionId: "session-1", toolCallId: "call-spawn" });
  assert.equal(attached.processHandle, spawned.processHandle);
  assert.equal(attached.snapshot().processState, "running");

  terminal.emitExit({ exitCode: 0 });
  assert.deepEqual(await spawned.completion, { exitCode: 0 });
  assert.equal(completed, true);
  manager.dispose();
});

test("writes agent-owned initial input into the PTY without waiting for UI attachment", async () => {
  const terminal = new FakePty();
  const manager = new ToolTerminalSessionManager({
    retentionMs: 60_000,
    spawnPty: () => terminal,
    terminatePty: (target) => target.kill(),
  });
  const spawned = manager.spawn({
    sessionId: "session-1",
    toolCallId: "call-agent-input",
    command: "read answer",
    cwd: "/workspace",
    initialInput: "yes\n",
    onData: () => {},
  });

  assert.deepEqual(terminal.writes, ["yes\n"]);
  terminal.emitExit({ exitCode: 0 });
  assert.deepEqual(await spawned.completion, { exitCode: 0 });
  manager.dispose();
});

test("rejects invalid timeouts with Pi-compatible validation before spawning a PTY", () => {
  let spawnCount = 0;
  const manager = new ToolTerminalSessionManager({
    spawnPty: () => {
      spawnCount += 1;
      return new FakePty();
    },
  });
  const options: ToolTerminalExecutionOptions = {
    sessionId: "session-1",
    toolCallId: "call-timeout",
    command: "sleep 1",
    cwd: "/workspace",
    onData: () => {},
  };

  for (const timeout of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => manager.spawn({ ...options, timeout }),
      /Invalid timeout: must be a finite number of seconds/,
    );
  }
  assert.throws(
    () => manager.spawn({ ...options, timeout: 2_147_483.648 }),
    /Invalid timeout: maximum is 2147483\.647 seconds/,
  );
  assert.equal(spawnCount, 0);
  manager.dispose();
});

test("chooses command arguments from the actual shell executable", async () => {
  const command = "printf ready";
  const cases: Array<{
    shell: string;
    platform: NodeJS.Platform;
    expected: string[];
  }> = [
    {
      shell: String.raw`C:\Program Files\Git\bin\bash.exe`,
      platform: "win32",
      expected: ["-lc", command],
    },
    {
      shell: "/usr/bin/pwsh",
      platform: "linux",
      expected: ["-NoLogo", "-NoProfile", "-Command", command],
    },
    {
      shell: String.raw`C:\Windows\System32\cmd.exe`,
      platform: "win32",
      expected: ["/d", "/s", "/c", command],
    },
  ];

  for (const [index, item] of cases.entries()) {
    const terminal = new FakePty();
    let spawned: { file: string; args: readonly string[] } | undefined;
    const manager = new ToolTerminalSessionManager({
      shell: item.shell,
      platform: item.platform,
      retentionMs: 60_000,
      spawnPty: (file, args) => {
        spawned = { file, args };
        return terminal;
      },
      terminatePty: (target) => target.kill(),
    });
    const running = manager.execute({
      sessionId: "session-1",
      toolCallId: `call-shell-${index}`,
      command,
      cwd: "/workspace",
      onData: () => {},
    });

    assert.equal(spawned?.file, item.shell);
    assert.deepEqual(spawned?.args, item.expected);
    terminal.emitExit({ exitCode: 0 });
    assert.deepEqual(await running, { exitCode: 0 });
    manager.dispose();
  }
});

test("shares tool PTY output, input, resize, and interruption with attached clients", async () => {
  const terminals: FakePty[] = [];
  const manager = new ToolTerminalSessionManager({
    shell: "/bin/bash",
    platform: "linux",
    retentionMs: 60_000,
    terminatePty: (terminal) => terminal.kill(),
    spawnPty: () => {
      const terminal = new FakePty();
      terminals.push(terminal);
      return terminal;
    },
  });
  const output: string[] = [];
  const execution: ToolTerminalExecutionOptions = {
    sessionId: "session-1",
    toolCallId: "call-1",
    command: "read value && echo $value",
    cwd: "/workspace",
    onData: (data) => output.push(data.toString("utf8")),
  };

  const running = manager.execute(execution);
  const attached = await manager.attach({
    sessionId: execution.sessionId,
    toolCallId: execution.toolCallId,
    cols: 120,
    rows: 40,
  });
  const live: string[] = [];
  const exits: TerminalProcessExit[] = [];
  const subscription = attached.subscribe({
    onOutput: (delta) => live.push(delta.data),
    onExit: (event) => exits.push(event),
  });

  assert.equal(subscription.replay.data, "$ read value && echo $value\r\n");
  assert.equal(attached.snapshot().kind, "tool");
  assert.equal(attached.snapshot().processHandle, "tool:session-1:call-1");
  terminals[0]!.emitData("\u001b[31mvalue?\u001b[0m ");
  attached.writeStdin("answer\r");
  attached.resizePty(90, 20);
  attached.terminate();

  assert.deepEqual(output, []);
  assert.deepEqual(live, ["\u001b[31mvalue?\u001b[0m "]);
  assert.deepEqual(terminals[0]!.writes, ["answer\r"]);
  assert.deepEqual(terminals[0]!.sizes, [
    { cols: 120, rows: 40 },
    { cols: 90, rows: 20 },
  ]);
  assert.equal(terminals[0]!.killed, true);

  terminals[0]!.emitExit({ exitCode: 130 });
  await assert.rejects(running, /aborted/);
  assert.deepEqual(output, ["value? "]);
  assert.equal(exits.length, 1);
  assert.equal(exits[0]?.exitCode, 130);
  assert.equal(exits[0]?.processState, "killed");
  assert.equal(exits[0]?.reason, "terminated");
  subscription.detach();
  manager.dispose();
});

test("keeps raw PTY redraws for xterm while projecting only their stable final line", async () => {
  const terminal = new FakePty();
  const manager = new ToolTerminalSessionManager({
    retentionMs: 60_000,
    spawnPty: () => terminal,
    terminatePty: (target) => target.kill(),
  });
  const transcript: string[] = [];
  const running = manager.execute({
    sessionId: "session-1",
    toolCallId: "call-redraw",
    command: "download",
    cwd: "/workspace",
    onData: (data) => transcript.push(data.toString("utf8")),
  });
  const attached = await manager.attach({
    sessionId: "session-1",
    toolCallId: "call-redraw",
  });
  const raw: string[] = [];
  attached.subscribe({
    onOutput: (delta) => raw.push(delta.data),
    onExit: () => {},
  });

  terminal.emitData("Cloning 10%\rCloning 20%\r");
  terminal.emitData("Cloning 100%\r\n");
  terminal.emitExit({ exitCode: 0 });

  assert.deepEqual(await running, { exitCode: 0 });
  assert.deepEqual(raw, ["Cloning 10%\rCloning 20%\r", "Cloning 100%\r\n"]);
  assert.deepEqual(transcript, ["Cloning 100%\n"]);
  manager.dispose();
});

test("keeps a completed tool terminal available for output replay", async () => {
  const terminal = new FakePty();
  const manager = new ToolTerminalSessionManager({
    retentionMs: 60_000,
    spawnPty: () => terminal,
    terminatePty: (target) => target.kill(),
  });
  const running = manager.execute({
    sessionId: "session-1",
    toolCallId: "call-2",
    command: "printf done",
    cwd: "/workspace",
    onData: () => {},
  });
  terminal.emitData("done");
  terminal.emitExit({ exitCode: 0 });

  assert.deepEqual(await running, { exitCode: 0 });
  const attached = await manager.attach({ sessionId: "session-1", toolCallId: "call-2" });
  const exit = new Promise<TerminalProcessExit>((resolve) => {
    const subscription = attached.subscribe({ onOutput: () => {}, onExit: resolve });
    assert.equal(subscription.replay.data, "$ printf done\r\ndone");
  });
  const completed = await exit;
  assert.equal(completed.exitCode, 0);
  assert.equal(completed.processState, "exited");
  assert.equal(completed.reason, "exited");
  manager.dispose();
});

test("publishes possible and active interaction independently from process state", async () => {
  const terminal = new FakePty();
  const manager = new ToolTerminalSessionManager({
    retentionMs: 60_000,
    interactionDetectorOptions: { quietPeriodMs: 0 },
    spawnPty: () => terminal,
    terminatePty: (target) => target.kill(),
  });
  const running = manager.execute({
    sessionId: "session-1",
    toolCallId: "call-interactive",
    command: "npx skills add example",
    cwd: "/workspace",
    onData: () => {},
  });
  const attached = await manager.attach({
    sessionId: "session-1",
    toolCallId: "call-interactive",
  });
  const states: string[] = [];
  const possible = new Promise<void>((resolve) => {
    attached.subscribe({
      onOutput: () => {},
      onExit: () => {},
      onStateChange: (snapshot) => {
        states.push(snapshot.interactionState);
        if (snapshot.interactionState === "possible") resolve();
      },
    });
  });

  terminal.emitData("\u001b[?25l\u001b[1G\u001b[JSelect a skill");
  await possible;
  assert.equal(attached.snapshot().interactionState, "possible");

  attached.writeStdin("1\r");
  assert.equal(attached.snapshot().interactionState, "active");
  assert.deepEqual(states, ["none", "possible", "active"]);

  terminal.emitExit({ exitCode: 0 });
  await running;
  assert.equal(attached.snapshot().interactionState, "none");
  assert.deepEqual(states, ["none", "possible", "active", "none"]);
  manager.dispose();
});

test("dispose closes tool terminal spawn and attach admission idempotently", async () => {
  let spawnCount = 0;
  const manager = new ToolTerminalSessionManager({
    spawnPty: () => {
      spawnCount += 1;
      return new FakePty();
    },
  });
  manager.dispose();
  manager.dispose();

  assert.throws(
    () =>
      manager.spawn({
        sessionId: "session-closed",
        toolCallId: "call-closed",
        command: "printf never",
        cwd: "/workspace",
        onData: () => {},
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "invalid-session" &&
      error.message === "Tool terminal session manager is disposed.",
  );
  await assert.rejects(
    manager.attach({ sessionId: "session-closed", toolCallId: "call-closed" }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "invalid-session" &&
      error.message === "Tool terminal session manager is disposed.",
  );
  assert.equal(spawnCount, 0);
});

test("a synchronous dispose inside the tool PTY spawner terminates the unowned PTY", async () => {
  const terminal = new FakePty();
  let manager!: ToolTerminalSessionManager;
  manager = new ToolTerminalSessionManager({
    spawnPty: () => {
      manager.dispose();
      return terminal;
    },
    terminatePty: (target) => target.kill(),
  });

  assert.throws(
    () =>
      manager.spawn({
        sessionId: "session-reentrant",
        toolCallId: "call-reentrant",
        command: "printf never",
        cwd: "/workspace",
        onData: () => {},
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "invalid-session" &&
      error.message === "Tool terminal session manager is disposed.",
  );
  assert.equal(terminal.killed, true);
  await assert.rejects(
    manager.attach({ sessionId: "session-reentrant", toolCallId: "call-reentrant" }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "invalid-session",
  );
});
