const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
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
      timers: { clearInterval() {}, setInterval: () => ({ unref() {} }) },
    }),
    set(records_) {
      current = records_;
    },
  };
}

test("shared Windows census cleans only a reverified registered descendant after leader reparenting", async () => {
  const leader = processRecord({ pid: 811 });
  const descendant = processRecord({ parentPid: leader.pid, pid: 812 });
  const unrelated = processRecord({ parentPid: 1, pid: 813 });
  const value = fixture([leader, descendant, unrelated]);
  value.registry.register(leader.pid);
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
    const records = readWindowsProcessCensus();

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
