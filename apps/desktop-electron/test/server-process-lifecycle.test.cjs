const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  DEFAULT_GRACEFUL_TIMEOUT_MS,
  WORKBENCH_SHUTDOWN_MESSAGE_TYPE,
  createWindowsProcessRegistry,
  killWindowsProcessTree,
  registerServerProcess,
  stopServerProcess,
} = require("../src/server-process-lifecycle.cjs");

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

function windowsProcess({
  argv = ["C:\\Program Files\\nodejs\\node.exe", "C:\\release\\server.mjs"],
  commandLine = '"C:\\Program Files\\nodejs\\node.exe" "C:\\release\\server.mjs"',
  creationDate = "2026-08-31T12:00:00.0000000Z",
  executable = "C:\\Program Files\\nodejs\\node.exe",
  parentPid = 1,
  pid,
} = {}) {
  return { argv, commandLine, creationDate, executable, parentPid, pid };
}

function windowsCensusFixture(records) {
  let current = records;
  const registry = createWindowsProcessRegistry({
    readCensus: () => current,
    timers: {
      clearTimeout() {},
      setTimeout() {
        return { unref() {} };
      },
    },
  });
  return {
    registry,
    set(records_) {
      current = records_;
    },
  };
}

test("requests graceful shutdown over IPC on Windows", async () => {
  const child = new FakeChildProcess({ connected: true });
  const census = windowsCensusFixture([windowsProcess({ pid: child.pid })]);
  child.once("exit", () => census.set([]));
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
      windowsRegistry: census.registry,
    }),
    { exited: true, forced: false },
  );
  assert.deepEqual(child.sent, [{ type: WORKBENCH_SHUTDOWN_MESSAGE_TYPE }]);
  assert.deepEqual(child.signals, []);
});

test("signals only the managed leader on POSIX before process-tree escalation", async () => {
  const child = new FakeChildProcess();
  const groupSignals = [];
  child.kill = function kill(signal) {
    this.signals.push(signal);
    queueMicrotask(() => this.exit(0, signal));
    return true;
  };

  const result = await stopServerProcess(child, {
    platform: "linux",
    gracefulTimeoutMs: 50,
    forceTimeoutMs: 10,
    killGroup: (pid, signal) => groupSignals.push({ pid, signal }),
  });

  assert.deepEqual(result, { exited: true, forced: false });
  assert.deepEqual(child.signals, ["SIGTERM"]);
  assert.deepEqual(groupSignals, []);
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
  assert.deepEqual(child.signals, ["SIGTERM"]);
  assert.deepEqual(groupSignals, [{ pid: child.pid, signal: "SIGKILL" }]);
});

test("uses Windows process-tree cleanup after the IPC grace period", async () => {
  const child = new FakeChildProcess({ connected: true });
  const killedPids = [];
  const census = windowsCensusFixture([windowsProcess({ pid: child.pid })]);

  const result = await stopServerProcess(child, {
    platform: "win32",
    gracefulTimeoutMs: 1,
    forceTimeoutMs: 50,
    windowsRegistry: census.registry,
    killWindowsTree: async (pid) => {
      killedPids.push(pid);
      census.set([]);
      child.exit(null, "SIGKILL");
    },
  });

  assert.deepEqual(result, { exited: true, forced: true });
  assert.deepEqual(killedPids, [child.pid]);
});

test("cleans the Windows process tree immediately when no IPC channel exists", async () => {
  const child = new FakeChildProcess();
  const killedPids = [];
  const census = windowsCensusFixture([windowsProcess({ pid: child.pid })]);

  const result = await stopServerProcess(child, {
    platform: "win32",
    gracefulTimeoutMs: 50,
    forceTimeoutMs: 50,
    windowsRegistry: census.registry,
    killWindowsTree: async (pid) => {
      killedPids.push(pid);
      census.set([]);
      child.exit(null, "SIGKILL");
    },
  });

  assert.deepEqual(result, { exited: true, forced: true });
  assert.deepEqual(killedPids, [child.pid]);
  assert.deepEqual(child.signals, []);
});

test("the default cooperative grace remains longer than eight seconds", () => {
  assert.ok(DEFAULT_GRACEFUL_TIMEOUT_MS > 8_000);
});

test("a crashed leader still triggers best-effort cleanup of its isolated POSIX group", async () => {
  const child = new FakeChildProcess();
  child.exitCode = 1;
  const groupSignals = [];
  assert.deepEqual(
    await stopServerProcess(child, {
      platform: "linux",
      killGroup: (pid, signal) => groupSignals.push({ pid, signal }),
    }),
    { exited: true, forced: true },
  );
  assert.deepEqual(groupSignals, [{ pid: child.pid, signal: "SIGKILL" }]);
});

test("Windows dead leader cleans a previously registered live descendant by exact census identity", async () => {
  const child = new FakeChildProcess({ pid: 421 });
  const descendant = windowsProcess({
    argv: ["C:\\Program Files\\nodejs\\node.exe", "C:\\release\\runtime.mjs"],
    commandLine: '"C:\\Program Files\\nodejs\\node.exe" "C:\\release\\runtime.mjs"',
    creationDate: "2026-08-31T12:00:01.0000000Z",
    parentPid: child.pid,
    pid: 422,
  });
  const census = windowsCensusFixture([windowsProcess({ pid: child.pid }), descendant]);
  await registerServerProcess(child, { platform: "win32", windowsRegistry: census.registry });
  child.exit(1, null);
  census.set([descendant]);
  const killed = [];

  const result = await stopServerProcess(child, {
    platform: "win32",
    windowsRegistry: census.registry,
    killWindowsTree: async (pid) => {
      killed.push(pid);
      census.set([]);
    },
  });

  assert.deepEqual(result, { exited: true, forced: true });
  assert.deepEqual(killed, [descendant.pid]);
});

test("Windows dead-leader helper failure does not claim the registered descendant was cleaned", async () => {
  const child = new FakeChildProcess({ pid: 421 });
  const descendant = windowsProcess({ parentPid: child.pid, pid: 422 });
  const census = windowsCensusFixture([windowsProcess({ pid: child.pid }), descendant]);
  await registerServerProcess(child, { platform: "win32", windowsRegistry: census.registry });
  child.exit(1, null);
  census.set([descendant]);

  const result = await stopServerProcess(child, {
    platform: "win32",
    windowsRegistry: census.registry,
    killWindowsTree: async () => {
      throw new Error("taskkill rejected the request");
    },
  });

  assert.deepEqual(result, { exited: false, forced: true });
});

test("Windows PID reuse or argv mismatch fails closed without terminating the replacement", async () => {
  const child = new FakeChildProcess({ pid: 421 });
  const descendant = windowsProcess({ parentPid: child.pid, pid: 422 });
  const census = windowsCensusFixture([windowsProcess({ pid: child.pid }), descendant]);
  await registerServerProcess(child, { platform: "win32", windowsRegistry: census.registry });
  child.exit(1, null);
  census.set([
    windowsProcess({
      argv: ["C:\\Program Files\\nodejs\\node.exe", "C:\\release\\unrelated.mjs"],
      commandLine: '"C:\\Program Files\\nodejs\\node.exe" "C:\\release\\unrelated.mjs"',
      creationDate: "2026-08-31T12:05:00.0000000Z",
      parentPid: 1,
      pid: descendant.pid,
    }),
  ]);
  const killed = [];

  const result = await stopServerProcess(child, {
    platform: "win32",
    windowsRegistry: census.registry,
    killWindowsTree: async (pid) => killed.push(pid),
  });

  assert.deepEqual(result, { exited: false, forced: true });
  assert.deepEqual(killed, []);
});

test("Windows orphan cleanup ignores an unrelated quoted-command decoy outside the registered parent chain", async () => {
  const child = new FakeChildProcess({ pid: 421 });
  const descendant = windowsProcess({ parentPid: child.pid, pid: 422 });
  const decoy = windowsProcess({
    argv: ["C:\\Program Files\\nodejs\\node.exe", "C:\\release\\runtime.mjs", "--decoy"],
    commandLine: '"C:\\Program Files\\nodejs\\node.exe" "C:\\release\\runtime.mjs" --decoy',
    parentPid: 99,
    pid: 423,
  });
  const census = windowsCensusFixture([windowsProcess({ pid: child.pid }), descendant, decoy]);
  await registerServerProcess(child, { platform: "win32", windowsRegistry: census.registry });
  child.exit(1, null);
  census.set([descendant, decoy]);
  const killed = [];

  const result = await stopServerProcess(child, {
    platform: "win32",
    windowsRegistry: census.registry,
    killWindowsTree: async (pid) => {
      killed.push(pid);
      census.set([decoy]);
    },
  });

  assert.deepEqual(result, { exited: true, forced: true });
  assert.deepEqual(killed, [descendant.pid]);
});

test("Windows crashed leader without a pre-registration fails closed instead of taskkilling a reusable PID", async () => {
  const child = new FakeChildProcess({ pid: 421 });
  child.exit(1, null);
  const killed = [];

  const result = await stopServerProcess(child, {
    platform: "win32",
    killWindowsTree: async (pid) => killed.push(pid),
  });

  assert.deepEqual(result, { exited: false, forced: true });
  assert.deepEqual(killed, []);
});

test("rejects a non-zero Windows taskkill result instead of claiming cleanup", async () => {
  const killer = new EventEmitter();
  const operation = killWindowsProcessTree(421, {
    spawnImpl(command, args) {
      assert.equal(command, "taskkill");
      assert.deepEqual(args, ["/pid", "421", "/T", "/F"]);
      return killer;
    },
  });
  killer.emit("exit", 1, null);
  await assert.rejects(operation, /taskkill failed/u);
});
