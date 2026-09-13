import assert from "node:assert/strict";
import test from "node:test";

import {
  createRpcError,
  isRpcDomainError,
  RpcBusinessError,
  RpcDomainError,
  rpcBusinessError,
} from "@workbench/api/errors";

class ExampleDomainError extends RpcDomainError<"example-failed", { resourceId: string }> {
  readonly code = "example-failed" as const;
  readonly details: { resourceId: string };

  constructor(resourceId: string, options?: ErrorOptions) {
    super("The example failed.", options);
    this.name = "ExampleDomainError";
    this.details = { resourceId };
  }
}

test("recognizes explicitly branded domain errors without serializing the brand", () => {
  const cause = new Error("internal cause");
  const error = new ExampleDomainError("resource-1", { cause });

  assert.equal(isRpcDomainError(error), true);
  assert.equal(error.cause, cause);
  assert.deepEqual(Object.keys(error).sort(), ["code", "details", "name"]);
  assert.deepEqual(JSON.parse(JSON.stringify(error)), {
    name: "ExampleDomainError",
    code: "example-failed",
    details: { resourceId: "resource-1" },
  });
});

test("rejects ordinary errors even when they imitate the public error shape", () => {
  const lookalike = Object.assign(new Error("lookalike"), {
    code: "example-failed",
    details: { resourceId: "resource-1" },
  });

  assert.equal(isRpcDomainError(lookalike), false);
  assert.equal(
    isRpcDomainError({ code: "example-failed", message: "lookalike", details: {} }),
    false,
  );
});

test("recognizes errors branded by the legacy Pi-owned implementation", () => {
  const error = Object.assign(new Error("legacy"), {
    code: "example-failed",
    details: { resourceId: "resource-1" },
  });
  Object.defineProperty(error, Symbol.for("workbench.pi.rpc-domain-error.v1"), { value: true });

  assert.equal(isRpcDomainError(error), true);
});

test("recognizes a current-brand error created by another class instance after HMR", () => {
  const error = Object.assign(new Error("reloaded"), {
    code: "example-failed",
    details: { resourceId: "resource-1" },
  });
  Object.defineProperty(error, Symbol.for("workbench.rpc-domain-error.v1"), { value: true });

  assert.equal(error instanceof RpcDomainError, false);
  assert.equal(isRpcDomainError(error), true);
});

test("rejects branded errors whose public details are not a plain object shape", () => {
  for (const details of [null, [], "details"]) {
    const error = Object.assign(new Error("invalid"), { code: "example-failed", details });
    Object.defineProperty(error, Symbol.for("workbench.rpc-domain-error.v1"), { value: true });
    assert.equal(isRpcDomainError(error), false);
  }
});

test("constructs RPC error values without changing their details", () => {
  const details = { resourceId: "resource-1" };
  const error = createRpcError("example-failed", "The example failed.", details);

  assert.deepEqual(error, {
    code: "example-failed",
    message: "The example failed.",
    details,
  });
  assert.equal(error.details, details);
});

test("constructs business errors with the RPC message, value, and Error options", () => {
  const cause = new Error("internal cause");
  const rpcError = createRpcError("example-failed", "The example failed.", {
    resourceId: "resource-1",
  });
  const direct = new RpcBusinessError(rpcError, { cause });
  const created = rpcBusinessError(
    "example-failed",
    "The example failed.",
    { resourceId: "resource-1" },
    { cause },
  );

  assert.equal(direct.name, "RpcBusinessError");
  assert.equal(direct.message, rpcError.message);
  assert.equal(direct.rpcError, rpcError);
  assert.equal(direct.cause, cause);
  assert.ok(created instanceof RpcBusinessError);
  assert.equal(created.message, "The example failed.");
  assert.deepEqual(created.rpcError, rpcError);
  assert.equal(created.cause, cause);
});
