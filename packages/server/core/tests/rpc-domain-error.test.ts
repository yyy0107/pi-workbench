import assert from "node:assert/strict";
import test from "node:test";

import { isRpcDomainError, RpcDomainError } from "@workbench/server-core/rpc-domain-error";

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
