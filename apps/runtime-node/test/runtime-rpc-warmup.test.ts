import assert from "node:assert/strict";
import test from "node:test";

import { warmRuntimeRpc } from "../src/runtime-rpc-warmup";

test("warms the injected Runtime graph directly with a trusted RPC request", async () => {
  const requests: Request[] = [];
  await warmRuntimeRpc(async (request) => {
    requests.push(request);
    const envelope = (await request.json()) as { rpcId: string };
    return Response.json({
      type: "server-response",
      rpcId: envelope.rpcId,
      result: { ok: true, value: { items: [] } },
    });
  }, "session.list");

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "http://127.0.0.1/api/session.list");
  assert.equal(requests[0]?.headers.get("host"), "127.0.0.1");
});

test("rejects a malformed or failed Runtime warmup response", async () => {
  await assert.rejects(
    warmRuntimeRpc(async () => Response.json({ ok: true }, { status: 503 }), "session.list"),
    /session\.list warmup failed with HTTP 503/u,
  );
});
