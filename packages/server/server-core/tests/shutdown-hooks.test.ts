import assert from "node:assert/strict";
import test from "node:test";

import {
  registerWorkbenchShutdownHook,
  runWorkbenchShutdownHooks,
} from "@workbench/server-core/shutdown-hooks";

test("replaces same-name shutdown hooks and runs every current hook once", async () => {
  const calls: string[] = [];
  registerWorkbenchShutdownHook("test:replace", () => {
    calls.push("stale");
  });
  registerWorkbenchShutdownHook("test:replace", () => {
    calls.push("replacement");
  });
  registerWorkbenchShutdownHook("test:second", async () => {
    calls.push("second");
  });

  assert.deepEqual(await runWorkbenchShutdownHooks(), []);
  assert.deepEqual(calls.sort(), ["replacement", "second"]);
  assert.deepEqual(await runWorkbenchShutdownHooks(), []);
  assert.equal(calls.length, 2);
});

test("collects cleanup failures without skipping unrelated hooks", async () => {
  let completed = false;
  const failure = new Error("cleanup failed");
  registerWorkbenchShutdownHook("test:failure", () => {
    throw failure;
  });
  registerWorkbenchShutdownHook("test:success", () => {
    completed = true;
  });

  assert.deepEqual(await runWorkbenchShutdownHooks(), [failure]);
  assert.equal(completed, true);
});
