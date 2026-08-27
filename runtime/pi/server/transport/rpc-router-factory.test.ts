import assert from "node:assert/strict";
import test from "node:test";

import { createPiRpcRouter } from "./rpc-router";
import type { RpcRouteGroup } from "./routes/rpc-route-group";

test("dispatches injected route groups before the exceptional respond handler", async () => {
  const calls: string[] = [];
  const routeGroup: RpcRouteGroup = {
    handle(_request, method) {
      calls.push(`route:${method}`);
      return method === "claimed" || method === "respond"
        ? Promise.resolve(new Response("claimed", { status: 201 }))
        : undefined;
    },
  };
  const router = createPiRpcRouter({
    routeGroups: [routeGroup],
    respond: async () => {
      calls.push("respond");
      return new Response("responded", { status: 202 });
    },
  });
  const request = new Request("http://127.0.0.1:3000/api/claimed");

  assert.equal((await router(request, "claimed")).status, 201);
  assert.equal((await router(request, "respond")).status, 201);
  assert.deepEqual(calls, ["route:claimed", "route:respond"]);
});

test("uses the injected respond handler and returns 404 after every route declines", async () => {
  const calls: string[] = [];
  const router = createPiRpcRouter({
    routeGroups: [
      {
        handle(_request, method) {
          calls.push(`route:${method}`);
          return undefined;
        },
      },
    ],
    respond: async () => {
      calls.push("respond");
      return new Response("responded", { status: 202 });
    },
  });
  const request = new Request("http://127.0.0.1:3000/api/respond");

  assert.equal((await router(request, "respond")).status, 202);
  assert.equal((await router(request, "unknown.method")).status, 404);
  assert.deepEqual(calls, ["route:respond", "respond", "route:unknown.method"]);
});
