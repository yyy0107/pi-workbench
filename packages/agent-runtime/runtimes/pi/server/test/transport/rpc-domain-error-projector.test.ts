import assert from "node:assert/strict";
import test from "node:test";

import { RpcDomainError } from "@workbench/server-core/rpc-domain-error";
import { RpcBusinessError } from "@workbench/host-server/rpc";
import { projectRpcDomainError } from "@workbench/host-server/rpc";

class ExampleDomainError extends RpcDomainError<"example-failed", { resourceId: string }> {
  readonly code = "example-failed" as const;
  readonly details = { resourceId: "resource-1" };

  constructor() {
    super("The example failed.");
    this.name = "ExampleDomainError";
  }
}

test("projects a branded domain error into the stable RPC business envelope", () => {
  const error = new ExampleDomainError();

  assert.throws(
    () => projectRpcDomainError(error),
    (projected: unknown) => {
      assert.ok(projected instanceof RpcBusinessError);
      assert.equal(projected.cause, error);
      assert.deepEqual(projected.rpcError, {
        code: "example-failed",
        message: "The example failed.",
        details: { resourceId: "resource-1" },
      });
      return true;
    },
  );
});

test("rethrows unbranded lookalikes without exposing their fields", () => {
  const lookalike = Object.assign(new Error("secret internal failure"), {
    code: "forged-code",
    details: { secret: "do-not-expose" },
  });

  assert.throws(
    () => projectRpcDomainError(lookalike),
    (error: unknown) => error === lookalike,
  );
});
