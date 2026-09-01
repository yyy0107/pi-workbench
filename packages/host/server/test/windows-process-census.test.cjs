const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createWindowsProcessRegistry,
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
