const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  WORKBENCH_SHUTDOWN_MESSAGE_TYPE,
  stopServerProcess,
} = require("./server-process-lifecycle.cjs");

class FakeChildProcess extends EventEmitter {
  constructor({ connected = false, pid = 421 } = {}) {
    super();
    this.connected = connected;
    this.exitCode = null;
    this.signalCode = null;
    this.pid = pid;
    this.sent = [];
    this.signals = [];
  }

  send(message, callback) {
    this.sent.push(message);
    callback?.();
  }

  kill(signal) {
    this.signals.push(signal);
    return true;
  }

  exit(code = 0, signal = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }
}

test("requests graceful shutdown over IPC on Windows", async () => {
  const child = new FakeChildProcess({ connected: true });
  child.send = function send(message, callback) {
    this.sent.push(message);
    callback?.();
    queueMicrotask(() => this.exit());
  };

  assert.deepEqual(
    await stopServerProcess(child, {
      platform: "win32",
      gracefulTimeoutMs: 50,
      forceTimeoutMs: 10,
    }),
    { exited: true, forced: false },
  );
  assert.deepEqual(child.sent, [{ type: WORKBENCH_SHUTDOWN_MESSAGE_TYPE }]);
  assert.deepEqual(child.signals, []);
});

test("signals the isolated process group on POSIX", async () => {
  const child = new FakeChildProcess();
  const groupSignals = [];

  const result = await stopServerProcess(child, {
    platform: "linux",
    gracefulTimeoutMs: 50,
    forceTimeoutMs: 10,
    killGroup: (pid, signal) => {
      groupSignals.push({ pid, signal });
      queueMicrotask(() => child.exit(0, signal));
    },
  });

  assert.deepEqual(result, { exited: true, forced: false });
  assert.deepEqual(groupSignals, [{ pid: child.pid, signal: "SIGTERM" }]);
});

test("escalates from graceful shutdown to a forced POSIX process-tree kill", async () => {
  const child = new FakeChildProcess();
  const groupSignals = [];

  const result = await stopServerProcess(child, {
    platform: "linux",
    gracefulTimeoutMs: 1,
    forceTimeoutMs: 50,
    killGroup: (pid, signal) => {
      groupSignals.push({ pid, signal });
      if (signal === "SIGKILL") queueMicrotask(() => child.exit(null, signal));
    },
  });

  assert.deepEqual(result, { exited: true, forced: true });
  assert.deepEqual(groupSignals, [
    { pid: child.pid, signal: "SIGTERM" },
    { pid: child.pid, signal: "SIGKILL" },
  ]);
});

test("uses Windows process-tree cleanup after the IPC grace period", async () => {
  const child = new FakeChildProcess({ connected: true });
  const killedPids = [];

  const result = await stopServerProcess(child, {
    platform: "win32",
    gracefulTimeoutMs: 1,
    forceTimeoutMs: 50,
    killWindowsTree: async (pid) => {
      killedPids.push(pid);
      child.exit(null, "SIGKILL");
    },
  });

  assert.deepEqual(result, { exited: true, forced: true });
  assert.deepEqual(killedPids, [child.pid]);
});

test("cleans the Windows process tree immediately when no IPC channel exists", async () => {
  const child = new FakeChildProcess();
  const killedPids = [];

  const result = await stopServerProcess(child, {
    platform: "win32",
    gracefulTimeoutMs: 50,
    forceTimeoutMs: 50,
    killWindowsTree: async (pid) => {
      killedPids.push(pid);
      child.exit(null, "SIGKILL");
    },
  });

  assert.deepEqual(result, { exited: true, forced: true });
  assert.deepEqual(killedPids, [child.pid]);
  assert.deepEqual(child.signals, []);
});
