import assert from "node:assert/strict";
import test from "node:test";

import { createInstalledPiDisposer } from "../src/composition/installed-pi-server";

test("installed Pi disposal stops Catalog, Automation, Execution, then Pi sessions exactly once", async () => {
  const calls: string[] = [];
  let releaseCatalog!: () => void;
  const catalogReleased = new Promise<void>((resolve) => (releaseCatalog = resolve));
  let releaseAutomation!: () => void;
  const automationReleased = new Promise<void>((resolve) => (releaseAutomation = resolve));
  let releaseExecution!: () => void;
  const executionReleased = new Promise<void>((resolve) => (releaseExecution = resolve));
  let reenteredDispose: Promise<void> | undefined;
  let dispose!: () => Promise<void>;
  dispose = createInstalledPiDisposer({
    async shutdownPackageCatalog() {
      calls.push("catalog:start");
      await catalogReleased;
      calls.push("catalog:end");
    },
    automation: {
      async shutdown() {
        calls.push("automation:start");
        await automationReleased;
        calls.push("automation:end");
      },
    },
    execution: {
      async shutdown() {
        calls.push("execution:start");
        reenteredDispose = dispose();
        await executionReleased;
        calls.push("execution:end");
      },
    },
    async runShutdownHooks() {
      calls.push("pi-sessions:shutdown");
      return [];
    },
  });

  const operation = dispose();
  assert.equal(dispose(), operation);
  assert.deepEqual(calls, ["catalog:start"]);
  releaseCatalog();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["catalog:start", "catalog:end", "automation:start"]);
  releaseAutomation();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(reenteredDispose, operation);
  assert.deepEqual(calls, [
    "catalog:start",
    "catalog:end",
    "automation:start",
    "automation:end",
    "execution:start",
  ]);
  releaseExecution();
  await operation;
  assert.deepEqual(calls, [
    "catalog:start",
    "catalog:end",
    "automation:start",
    "automation:end",
    "execution:start",
    "execution:end",
    "pi-sessions:shutdown",
  ]);
});

test("installed Pi disposal aggregates Catalog and Execution failures before session hooks", async () => {
  const catalogFailure = new Error("catalog failed");
  const executionFailure = new Error("execution failed");
  const hookFailure = new Error("Pi session failed");
  let hooks = 0;
  const dispose = createInstalledPiDisposer({
    async shutdownPackageCatalog() {
      throw catalogFailure;
    },
    automation: { async shutdown() {} },
    execution: {
      async shutdown() {
        throw executionFailure;
      },
    },
    async runShutdownHooks() {
      hooks += 1;
      return [hookFailure];
    },
  });

  await assert.rejects(dispose(), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [catalogFailure, executionFailure, hookFailure]);
    return true;
  });
  assert.equal(hooks, 1);
});
