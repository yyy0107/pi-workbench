import assert from "node:assert/strict";
import test from "node:test";

import { ExecutionError } from "@workbench/execution-server/errors";
import { isRpcDomainError } from "@workbench/server-core/rpc-domain-error";

test("ExecutionError preserves typed RPC-safe failure details", () => {
  const cause = new Error("storage failure");
  const error = new ExecutionError(
    "run-not-found",
    "The workflow run does not exist.",
    { runId: "run-1" },
    { cause },
  );

  assert.equal(error.name, "ExecutionError");
  assert.equal(error.code, "run-not-found");
  assert.deepEqual(error.details, { runId: "run-1" });
  assert.equal(error.cause, cause);
  assert.equal(isRpcDomainError(error), true);
});
