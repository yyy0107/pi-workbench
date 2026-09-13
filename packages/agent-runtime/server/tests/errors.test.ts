import assert from "node:assert/strict";
import test from "node:test";
import { AgentCommandCatalogError } from "../src/commands";
import { AgentExecutionError } from "../src/execution";
import { AgentThreadStoreError } from "../src/threads";

test("protocol error projection preserves public identity, causes and thread details", () => {
  const cause = new Error("storage unavailable");
  const details = { existingRootPath: "/existing-workspace" };
  const errors = [
    new AgentCommandCatalogError("thread-not-found", "catalog", { cause }),
    new AgentExecutionError("thread-not-found", "execution", { cause }),
    new AgentThreadStoreError("thread-not-found", "threads", details, { cause }),
  ];
  for (const [index, ErrorClass] of [
    AgentCommandCatalogError,
    AgentExecutionError,
    AgentThreadStoreError,
  ].entries()) {
    const error = errors[index]!;
    assert.ok(error instanceof Error);
    assert.ok(error instanceof ErrorClass);
    assert.equal(error.name, ErrorClass.name);
    assert.equal(error.code, "thread-not-found");
    assert.equal(error.cause, cause);
    assert.match(error.stack!, new RegExp(`${ErrorClass.name}: ${error.message}`));
  }
  assert.equal((errors[2] as AgentThreadStoreError).details, details);
  assert.deepEqual(new AgentThreadStoreError("internal", "failed").details, {});
});
