import assert from "node:assert/strict";
import test from "node:test";

import { createAutomationClient } from "../src/public/automation";

function rpcResponse(request: Request | string, input: RequestInit | undefined) {
  const body = input?.body ?? (request instanceof Request ? request.body : undefined);
  return Response.json({
    type: "server-response",
    rpcId: JSON.parse(String(body)).rpcId,
    result: { ok: true, value: { items: [] } },
  });
}

test("automation clients retain their installation-bound HTTP transport", async () => {
  const paths: string[] = [];
  const client = createAutomationClient({
    transport: async (path, init) => {
      paths.push(path);
      return rpcResponse(path, init);
    },
  });

  await client.list();

  assert.deepEqual(paths, ["/api/automation.list"]);
});
