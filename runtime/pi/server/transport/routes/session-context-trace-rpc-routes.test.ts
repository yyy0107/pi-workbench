import assert from "node:assert/strict";
import test from "node:test";

import type { RpcIssue, ServerResponse } from "@/runtime/pi/contracts/rpc";
import type { PiSessionContextTraceService } from "../../sessions/pi-session-context-trace-service";
import { rpcBusinessError } from "../rpc-transport";
import { createSessionContextTraceRpcRoutes } from "./session-context-trace-rpc-routes";

function rpcRequest(method: string, payload: unknown, rpcId = "rpc-1"): Request {
  return new Request(`http://127.0.0.1:3000/api/${method}`, {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
  });
}

function service(overrides: Partial<PiSessionContextTraceService>): PiSessionContextTraceService {
  return new Proxy(overrides, {
    get(target, property, receiver) {
      const implementation = Reflect.get(target, property, receiver);
      if (implementation !== undefined) return implementation;
      return async () => {
        throw new Error(`Unexpected Context Trace service call: ${String(property)}`);
      };
    },
  }) as PiSessionContextTraceService;
}

function routes(overrides: Partial<PiSessionContextTraceService>) {
  return createSessionContextTraceRpcRoutes({
    service: service(overrides),
    projectDomainError(error): never {
      throw error;
    },
  });
}

async function successValue<Value>(response: Response): Promise<Value> {
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<Value>;
  assert.equal(body.type, "server-response");
  if (!body.result.ok) assert.fail(`Unexpected RPC error: ${body.result.error.code}`);
  return body.result.value;
}

test("claims Context Trace methods without consuming neighboring session domains", async () => {
  const contextTraceRoutes = routes({ list: async () => ({}) as never });
  const claimed = contextTraceRoutes.handle(
    rpcRequest("session.contextTrace.list", { sessionId: "session-1" }),
    "session.contextTrace.list",
  );

  assert.ok(claimed);
  assert.deepEqual(await successValue(await claimed), {});
  for (const method of [
    "session.list",
    "session.prompt",
    "sessionImport.scan",
    "respond",
    "session.contextTrace.unknown",
  ]) {
    assert.equal(contextTraceRoutes.handle(rpcRequest(method, {}), method), undefined);
  }
});

test("maps every Context Trace RPC method to the matching service operation", async () => {
  const calls: Array<{ operation: PropertyKey; args: unknown[] }> = [];
  const recordingService = new Proxy(
    {},
    {
      get(_target, operation) {
        return async (...args: unknown[]) => {
          calls.push({ operation, args });
          return {};
        };
      },
    },
  ) as PiSessionContextTraceService;
  const contextTraceRoutes = createSessionContextTraceRpcRoutes({
    service: recordingService,
    projectDomainError(error): never {
      throw error;
    },
  });
  const cases = [
    {
      method: "session.contextTrace.list",
      operation: "list",
      payload: {
        sessionId: "session-1",
        activationId: "activation-1",
        afterSeq: 4,
        limit: 25,
      },
    },
    {
      method: "session.contextTrace.activations",
      operation: "activations",
      payload: { sessionId: "session-1" },
    },
    {
      method: "session.contextTrace.promptParts",
      operation: "promptParts",
      payload: { sessionId: "session-1" },
    },
    {
      method: "session.contextTrace.read",
      operation: "read",
      payload: { sessionId: "session-1", traceId: "activation-1:4" },
    },
  ] as const;

  for (const route of cases) {
    calls.length = 0;
    const response = contextTraceRoutes.handle(
      rpcRequest(route.method, { ...route.payload, ignored: true }),
      route.method,
    );
    assert.ok(response, `Route was not claimed: ${route.method}`);
    await successValue(await response);
    assert.deepEqual(calls, [{ operation: route.operation, args: [route.payload] }]);
  }
});

test("rejects invalid bounded trace coordinates before invoking the service", async () => {
  let calls = 0;
  const contextTraceRoutes = createSessionContextTraceRpcRoutes({
    service: new Proxy(
      {},
      {
        get() {
          return async () => {
            calls += 1;
            return {};
          };
        },
      },
    ) as PiSessionContextTraceService,
    projectDomainError(error): never {
      throw error;
    },
  });

  for (const [method, payload] of [
    ["session.contextTrace.list", { sessionId: "session-1", limit: 501 }],
    ["session.contextTrace.list", { sessionId: "session-1", afterSeq: -2 }],
    ["session.contextTrace.activations", { sessionId: "" }],
    ["session.contextTrace.promptParts", { sessionId: "" }],
    ["session.contextTrace.read", { sessionId: "session-1", traceId: "" }],
  ] as const) {
    const response = contextTraceRoutes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    const body = (await (await response).json()) as ServerResponse<never, { issues: RpcIssue[] }>;
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail(`Expected a ${method} validation failure.`);
    assert.equal(body.result.error.code, "bad-request");
  }
  assert.equal(calls, 0);
});

test("delegates service failures to the transport-owned domain error projector", async () => {
  const failure = new Error("journal read failed");
  const contextTraceRoutes = createSessionContextTraceRpcRoutes({
    service: service({
      read: async () => {
        throw failure;
      },
    }),
    projectDomainError(error): never {
      assert.equal(error, failure);
      throw rpcBusinessError("projected-context-trace-error", "Projected trace failure.", {
        stable: true,
      });
    },
  });
  const response = contextTraceRoutes.handle(
    rpcRequest("session.contextTrace.read", {
      sessionId: "session-1",
      traceId: "activation-1:4",
    }),
    "session.contextTrace.read",
  );

  assert.ok(response);
  const body = (await (await response).json()) as ServerResponse<never>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a projected RPC failure.");
  assert.deepEqual(body.result.error, {
    code: "projected-context-trace-error",
    message: "Projected trace failure.",
    details: { stable: true },
  });
});
