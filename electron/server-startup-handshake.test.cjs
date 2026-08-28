const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  parseWorkbenchReadyMessage,
  waitForWorkbenchServerReady,
} = require("./server-startup-handshake.cjs");

function childProcessFixture(pid = 4321) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.pid = pid;
  child.signalCode = null;
  return child;
}

test("accepts only a versioned ready message from the expected child and host", () => {
  const valid = {
    type: "workbench:ready",
    version: 1,
    host: "127.0.0.1",
    port: 41_337,
    pid: 4321,
  };
  const expected = { expectedHost: "127.0.0.1", expectedPid: 4321 };

  assert.deepEqual(parseWorkbenchReadyMessage(valid, expected), {
    host: "127.0.0.1",
    pid: 4321,
    port: 41_337,
    url: "http://127.0.0.1:41337",
  });
  assert.equal(parseWorkbenchReadyMessage({ ...valid, version: 2 }, expected), undefined);
  assert.equal(parseWorkbenchReadyMessage({ ...valid, host: "0.0.0.0" }, expected), undefined);
  assert.equal(parseWorkbenchReadyMessage({ ...valid, pid: 9999 }, expected), undefined);
  assert.equal(parseWorkbenchReadyMessage({ ...valid, port: 0 }, expected), undefined);
});

test("waits through unrelated IPC messages and resolves the structured handshake", async () => {
  const child = childProcessFixture();
  const readyPromise = waitForWorkbenchServerReady(child, { timeoutMs: 500 });

  child.emit("message", { type: "unrelated" });
  child.emit("message", {
    type: "workbench:ready",
    version: 1,
    host: "127.0.0.1",
    port: 45_678,
    pid: child.pid,
  });

  assert.equal((await readyPromise).url, "http://127.0.0.1:45678");
  assert.equal(child.listenerCount("message"), 0);
});

test("rejects when the child exits before announcing readiness", async () => {
  const child = childProcessFixture();
  const readyPromise = waitForWorkbenchServerReady(child, { timeoutMs: 500 });
  child.emit("exit", 1, null);

  await assert.rejects(readyPromise, /exited before its ready handshake \(code 1\)/);
});

test("rejects a missing handshake at the configured deadline", async () => {
  const child = childProcessFixture();
  await assert.rejects(
    waitForWorkbenchServerReady(child, { timeoutMs: 10 }),
    /did not send a ready handshake within 10ms/,
  );
});
