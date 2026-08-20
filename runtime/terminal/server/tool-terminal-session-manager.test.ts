import assert from "node:assert/strict";
import test from "node:test";

import {
  ToolTerminalSessionManager,
  type ToolTerminalExecutionOptions,
} from "./tool-terminal-session-manager";
import type { TerminalExitEvent, TerminalPty } from "./terminal-session-manager";

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
  const exits: TerminalExitEvent[] = [];
  const subscription = attached.subscribe({
    onData: (data) => live.push(data),
    onExit: (event) => exits.push(event),
  });

  assert.equal(subscription.history, "$ read value && echo $value\r\n");
  terminals[0]!.emitData("\u001b[31mvalue?\u001b[0m ");
  attached.write("answer\r");
  attached.resize(90, 20);
  attached.interrupt();

  assert.deepEqual(output, ["value? "]);
  assert.deepEqual(live, ["\u001b[31mvalue?\u001b[0m "]);
  assert.deepEqual(terminals[0]!.writes, ["answer\r"]);
  assert.deepEqual(terminals[0]!.sizes, [
    { cols: 120, rows: 40 },
    { cols: 90, rows: 20 },
  ]);
  assert.equal(terminals[0]!.killed, true);

  terminals[0]!.emitExit({ exitCode: 130 });
  await assert.rejects(running, /aborted/);
  assert.deepEqual(exits, [{ exitCode: 130 }]);
  subscription.detach();
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
  const exit = new Promise<TerminalExitEvent>((resolve) => {
    const subscription = attached.subscribe({ onData: () => {}, onExit: resolve });
    assert.equal(subscription.history, "$ printf done\r\ndone");
  });
  assert.deepEqual(await exit, { exitCode: 0 });
  manager.dispose();
});
