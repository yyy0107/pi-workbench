import assert from "node:assert/strict";
import test from "node:test";

import {
  dispatchRpcRouteGroups,
  type RpcRouteGroup,
} from "../../../src/transport/routes/rpc-route-group";

const request = new Request("http://127.0.0.1:3000/api/example");

test("dispatches to the first route group that claims a method", async () => {
  const calls: string[] = [];
  const groups: RpcRouteGroup[] = [
    {
      handle(receivedRequest, method) {
        assert.equal(receivedRequest, request);
        calls.push(`first:${method}`);
        return undefined;
      },
    },
    {
      handle(receivedRequest, method) {
        assert.equal(receivedRequest, request);
        calls.push(`second:${method}`);
        return Promise.resolve(new Response("claimed"));
      },
    },
    {
      handle() {
        assert.fail("dispatch must stop after a route group claims the method");
      },
    },
  ];

  const response = dispatchRpcRouteGroups(request, "example.method", groups);

  assert.ok(response);
  assert.equal(await (await response).text(), "claimed");
  assert.deepEqual(calls, ["first:example.method", "second:example.method"]);
});

test("returns undefined after every route group declines a method", () => {
  let calls = 0;
  const groups: RpcRouteGroup[] = Array.from({ length: 3 }, () => ({
    handle() {
      calls += 1;
      return undefined;
    },
  }));

  assert.equal(dispatchRpcRouteGroups(request, "unknown.method", groups), undefined);
  assert.equal(calls, 3);
});
