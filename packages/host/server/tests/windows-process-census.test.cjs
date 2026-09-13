const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { EventEmitter, once } = require("node:events");
const test = require("node:test");

const {
  createWindowsProcessRegistry,
  readWindowsProcessCensus,
  terminateVerifiedWindowsProcessTree,
} = require("../src/windows-process-census.cjs");

function processRecord({
  argv = ["C:\\Program Files\\nodejs\\node.exe", "C:\\release\\server.mjs"],
  commandLine = '"C:\\Program Files\\nodejs\\node.exe" "C:\\release\\server.mjs"',
  creationDate = "2026-08-31T12:00:00.0000000Z",
  executable = "C:\\Program Files\\nodejs\\node.exe",
  parentPid = 1,
  pid,
} = {}) {
  return { argv, commandLine, creationDate, executable, parentPid, pid };
}

function fixture(records) {
  let current = records;
  return {
    registry: createWindowsProcessRegistry({
      readCensus: () => current,
      timers: { clearTimeout() {}, setTimeout: () => ({ unref() {} }) },
    }),
    set(records_) {
      current = records_;
    },
  };
}

test("Windows census yields the event loop while PowerShell runs", async () => {
  const leader = processRecord({ pid: 811 });
  let finish;
  const reading = readWindowsProcessCensus({
    execFileImpl(command, args, options) {
      assert.equal(command, "powershell.exe");
      assert.ok(args.includes("-NoProfile"));
      assert.equal(options.windowsHide, true);
      assert.ok(options.timeout > 0);
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  let settled = false;
  void reading.then(() => {
    settled = true;
  });
  await new Promise(setImmediate);
  assert.equal(settled, false);
  finish({ stdout: JSON.stringify([leader]) });
  assert.deepEqual(await reading, [leader]);
});

test("slow Windows scans leave an idle gap and shutdown waits for a fresh serialized census", async () => {
  const leader = processRecord({ pid: 811 });
  const descendant = processRecord({ pid: 812, parentPid: leader.pid });
  const reads = [];
  const scheduled = new Set();
  const registry = createWindowsProcessRegistry({
    readCensus: () => new Promise((resolve) => reads.push(resolve)),
    timers: {
      clearTimeout: (timer) => scheduled.delete(timer),
      setTimeout(callback, delay) {
        assert.equal(delay, 1_000);
        scheduled.add(callback);
        return callback;
      },
    },
  });
  const registration = registry.register(leader.pid);
  await new Promise(setImmediate);
  assert.equal(scheduled.size, 0);
  reads.shift()([leader]);
  await registration;
  assert.equal(scheduled.size, 1);

  const [poll] = scheduled;
  scheduled.delete(poll);
  const scanning = poll();
  await new Promise(setImmediate);
  assert.equal(scheduled.size, 0);
  const killed = [];
  const cleanup = terminateVerifiedWindowsProcessTree(registry, async (pid) => killed.push(pid));
  await new Promise(setImmediate);
  assert.equal(reads.length, 1); // Shutdown has not launched a second concurrent PowerShell.
  reads.shift()([leader, descendant]);
  await scanning;
  await new Promise(setImmediate);
  assert.equal(reads.length, 1); // A new census, not the stale scan that still had the leader.
  assert.deepEqual(killed, []);
  reads.shift()([descendant]);
  await cleanup;
  assert.deepEqual(killed, [descendant.pid]);
  assert.equal(scheduled.size, 0);
});

test("leader exit during the initial asynchronous census does not restart monitoring", async () => {
  const child = new EventEmitter();
  let finish;
  const registry = createWindowsProcessRegistry({
    readCensus: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    timers: {
      clearTimeout() {},
      setTimeout() {
        assert.fail("monitoring restarted after exit");
      },
    },
  });
  const registration = registry.register(811, child);
  await new Promise(setImmediate);
  child.emit("exit");
  finish([processRecord({ pid: 811 })]);
  await registration;
});

test("asynchronous census failure stops polling and refuses unverified cleanup", async () => {
  const failure = new Error("PowerShell census timed out");
  let poll;
  let reads = 0;
  const registry = createWindowsProcessRegistry({
    async readCensus() {
      if (reads++ > 0) throw failure;
      return [processRecord({ pid: 811 })];
    },
    timers: {
      clearTimeout() {},
      setTimeout(callback) {
        poll = callback;
        return callback;
      },
    },
  });
  await registry.register(811);
  const scanning = poll;
  poll = undefined;
  await scanning();
  assert.equal(registry.failure, failure);
  assert.equal(poll, undefined);
  await assert.rejects(
    terminateVerifiedWindowsProcessTree(registry, () => assert.fail("unverified process killed")),
    failure,
  );
});

test("shared Windows census cleans only a reverified registered descendant after leader reparenting", async () => {
  const leader = processRecord({ pid: 811 });
  const descendant = processRecord({ parentPid: leader.pid, pid: 812 });
  const unrelated = processRecord({ parentPid: 1, pid: 813 });
  const value = fixture([leader, descendant, unrelated]);
  await value.registry.register(leader.pid);
  value.set([descendant, unrelated]);
  const killed = [];

  await terminateVerifiedWindowsProcessTree(value.registry, async (pid) => {
    killed.push(pid);
    value.set([unrelated]);
  });

  assert.deepEqual(killed, [descendant.pid]);
});

test(
  "real Windows census preserves exact Unicode, quoted, and multiline argv",
  { skip: process.platform !== "win32" },
  async (t) => {
    const args = [
      "-e",
      "setInterval(() => {}, 1000)",
      "--",
      "中文 with spaces",
      'quoted "value"',
      "first\r\nsecond",
      "trailing\\",
    ];
    const child = spawn(process.execPath, args, { stdio: "ignore", windowsHide: true });
    t.after(() => child.kill());
    await once(child, "spawn");
    const records = await readWindowsProcessCensus();

    assert.deepEqual(records.find(({ pid }) => pid === child.pid)?.argv, [
      process.execPath,
      ...args,
    ]);
    assert.ok(records.length > 0);
    for (const record of records) {
      assert.ok(Array.isArray(record.argv));
      assert.ok(record.argv.length > 0);
      assert.ok(record.argv.every((argument) => typeof argument === "string"));
    }
  },
);
