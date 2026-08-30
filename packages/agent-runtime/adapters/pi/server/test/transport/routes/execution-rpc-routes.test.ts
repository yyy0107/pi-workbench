import assert from "node:assert/strict";
import test from "node:test";

import type { ServerResponse } from "@workbench/agent-runtime-pi-protocol/rpc";
import type { ExecutionProtocol } from "@workbench/execution-contracts";
import { createExecutionRpcRoutes } from "../../../src/transport/routes/execution-rpc-routes";

function rpcRequest(method: string, payload: unknown): Request {
  return new Request(`http://127.0.0.1:3000/api/${method}`, {
    method: "POST",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
    body: JSON.stringify({ type: "client-request", rpcId: "rpc-save-draft", method, payload }),
  });
}

test("rejects Automation definitions at the Workflow HTTP RPC boundary", async () => {
  const routes = createExecutionRpcRoutes({
    service: {} as ExecutionProtocol,
    projectDomainError(error): never {
      throw error;
    },
  });
  const response = routes.handle(
    rpcRequest("workflow.create", {
      kind: "automation",
      scope: { type: "personal" },
      name: "Scheduled task",
    }),
    "workflow.create",
  );

  assert.ok(response);
  const resolved = await response;
  assert.equal(resolved.status, 200);
  const body = (await resolved.json()) as ServerResponse<never>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected Workflow to reject Automation.");
  assert.equal(body.result.error.code, "bad-request");
});
