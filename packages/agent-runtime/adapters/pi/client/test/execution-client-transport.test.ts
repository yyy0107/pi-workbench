import assert from "node:assert/strict";
import test from "node:test";

import { createAutomationClient, createWorkflowClient } from "../src/public/execution";

function rpcResponse(request: Request | string, input: RequestInit | undefined) {
  const body = input?.body ?? (request instanceof Request ? request.body : undefined);
  return Response.json({
    type: "server-response",
    rpcId: JSON.parse(String(body)).rpcId,
    result: { ok: true, value: { items: [] } },
  });
}

test("execution client factories retain their installation-bound HTTP transport", async () => {
  const firstPaths: string[] = [];
  const secondPaths: string[] = [];
  const first = createWorkflowClient({
    transport: async (path, init) => {
      firstPaths.push(path);
      return rpcResponse(path, init);
    },
  });
  const second = createAutomationClient({
    transport: async (path, init) => {
      secondPaths.push(path);
      return rpcResponse(path, init);
    },
  });

  await Promise.all([first.list(), second.list()]);

  assert.deepEqual(firstPaths, ["/api/workflow.list"]);
  assert.deepEqual(secondPaths, ["/api/automation.list"]);
});
