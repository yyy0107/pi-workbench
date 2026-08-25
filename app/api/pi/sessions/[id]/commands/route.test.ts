import assert from "node:assert/strict";
import test from "node:test";

import { RPC_REQUEST_BODY_LIMITS } from "@/runtime/pi/server/transport/rpc-transport";

const { POST } = (await import(
  new URL("./route.ts", import.meta.url).href
)) as typeof import("./route");

test("legacy session commands share the bounded attachment JSON reader", async () => {
  const response = await POST(
    new Request("http://127.0.0.1:3000/api/pi/sessions/session-1/commands", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        "content-type": "application/json",
        "content-length": String(RPC_REQUEST_BODY_LIMITS.inlineAttachment + 1),
      },
      body: "{}",
    }),
    { params: Promise.resolve({ id: "session-1" }) },
  );

  assert.equal(response.status, 413);
  assert.equal(await response.text(), "Payload Too Large");
});
