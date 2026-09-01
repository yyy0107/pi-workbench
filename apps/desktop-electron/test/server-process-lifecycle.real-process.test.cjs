const assert = require("node:assert/strict");
const { fork } = require("node:child_process");
const { existsSync, readFileSync, rmSync } = require("node:fs");
const { mkdtemp } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { stopServerProcess } = require("../src/server-process-lifecycle.cjs");

const FIXTURE = path.join(__dirname, "test-fixtures", "server-process-lifecycle-worker.cjs");
const POSIX = process.platform !== "win32";
const POLL_MS = 10;
const READY_TIMEOUT_MS = 1_000;

function waitFor(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for ${description}.`));
        return;
      }
      setTimeout(check, POLL_MS);
    };
    check();
  });
}

function stateEvents(stateFile) {
  if (!existsSync(stateFile)) return [];
  return readFileSync(stateFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function processHasExited(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if (error?.code === "ESRCH") return true;
    throw error;
  }
}

async function spawnDetachedSupervisor({ stubborn = false } = {}) {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "workbench-lifecycle-"));
  const stateFile = path.join(stateDirectory, "events.ndjson");
  const child = fork(FIXTURE, ["supervisor", stateFile], {
    detached: true,
    env: {
      ...process.env,
      WORKBENCH_LIFECYCLE_STUBBORN: stubborn ? "1" : "0",
    },
    silent: true,
  });
  let identity;
  child.once("message", (message) => {
    if (message?.type === "ready") identity = message;
  });
  try {
    await waitFor(
      () => identity !== undefined,
      READY_TIMEOUT_MS,
      "detached supervisor fixture readiness",
    );
    await waitFor(
      () => stateEvents(stateFile).some(({ event }) => event === "grandchild-ready"),
      READY_TIMEOUT_MS,
      "detached Runtime-like child fixture readiness",
    );
  } catch (error) {
    await cleanupDetachedFixture({ child, identity, stateDirectory });
    throw error;
  }
  return { child, identity, stateDirectory, stateFile };
}

async function cleanupDetachedFixture({ child, identity, stateDirectory }) {
  const pids = [child?.pid, identity?.grandchildPid].filter(Number.isInteger);
  if (child?.pid && !processHasExited(child.pid)) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  await Promise.all(
    pids.map((pid) => waitFor(() => processHasExited(pid), 1_000, `fixture process ${pid}`)),
  );
  rmSync(stateDirectory, { force: true, recursive: true });
}

test(
  "POSIX graceful stop signals the detached supervisor before its Runtime-like child cooperatively exits",
  { skip: !POSIX },
  async () => {
    const fixture = await spawnDetachedSupervisor();
    try {
      const result = await stopServerProcess(fixture.child, {
        forceTimeoutMs: 500,
        gracefulTimeoutMs: 500,
      });

      assert.deepEqual(result, { exited: true, forced: false });
      await waitFor(
        () => stateEvents(fixture.stateFile).some(({ event }) => event === "supervisor-exit"),
        500,
        "cooperative supervisor exit",
      );
      assert.deepEqual(
        stateEvents(fixture.stateFile).map(({ event }) => event),
        [
          "supervisor-ready",
          "grandchild-ready",
          "supervisor-sigterm",
          "grandchild-ipc-stop",
          "supervisor-exit",
        ],
      );
      assert.equal(processHasExited(fixture.identity.grandchildPid), true);
    } finally {
      await cleanupDetachedFixture(fixture);
    }
  },
);

test(
  "POSIX forced stop kills a detached supervisor process group after the cooperative deadline",
  { skip: !POSIX },
  async () => {
    const fixture = await spawnDetachedSupervisor({ stubborn: true });
    try {
      const result = await stopServerProcess(fixture.child, {
        forceTimeoutMs: 1_000,
        gracefulTimeoutMs: 75,
      });

      assert.deepEqual(result, { exited: true, forced: true });
      await waitFor(
        () => processHasExited(fixture.identity.grandchildPid),
        1_000,
        "forced grandchild exit",
      );
      assert.deepEqual(
        stateEvents(fixture.stateFile).map(({ event }) => event),
        ["supervisor-ready", "grandchild-ready", "supervisor-ignored-sigterm"],
      );
    } finally {
      await cleanupDetachedFixture(fixture);
    }
  },
);
