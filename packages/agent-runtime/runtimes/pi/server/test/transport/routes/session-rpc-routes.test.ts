import assert from "node:assert/strict";
import test from "node:test";

import type { RpcIssue, ServerResponse } from "@workbench/agent-runtime-pi-protocol/rpc";
import type { PiSessionProtocolFacade } from "../../../src/sessions/pi-session-protocol-facade";
import { rpcBusinessError } from "@workbench/host-server/rpc";
import { createSessionRpcRoutes } from "../../../src/transport/routes/session-rpc-routes";

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

function protocol(overrides: Partial<PiSessionProtocolFacade>): PiSessionProtocolFacade {
  return new Proxy(overrides, {
    get(target, property, receiver) {
      const implementation = Reflect.get(target, property, receiver);
      if (implementation !== undefined) return implementation;
      return async () => {
        throw new Error(`Unexpected protocol call: ${String(property)}`);
      };
    },
  }) as PiSessionProtocolFacade;
}

function routes(overrides: Partial<PiSessionProtocolFacade>) {
  return createSessionRpcRoutes({
    protocol: protocol(overrides),
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

test("claims core session methods without consuming neighboring session subdomains", async () => {
  const sessionRoutes = routes({ list: async () => ({ items: [] }) });
  const claimed = sessionRoutes.handle(
    rpcRequest("session.list", { cursor: "reserved" }),
    "session.list",
  );

  assert.ok(claimed);
  assert.deepEqual(await successValue(await claimed), { items: [] });
  for (const method of [
    "session.contextTrace.list",
    "sessionImport.scan",
    "respond",
    "host.describe",
    "session.unknown",
  ]) {
    assert.equal(sessionRoutes.handle(rpcRequest(method, {}), method), undefined);
  }
});

test("maps every extracted RPC method to the matching protocol operation", async () => {
  const calls: Array<{ operation: PropertyKey; args: unknown[] }> = [];
  const recordingProtocol = new Proxy(
    {},
    {
      get(_target, operation) {
        return async (...args: unknown[]) => {
          calls.push({ operation, args });
          return {};
        };
      },
    },
  ) as PiSessionProtocolFacade;
  const sessionRoutes = createSessionRpcRoutes({
    protocol: recordingProtocol,
    projectDomainError(error): never {
      throw error;
    },
  });
  const cases: ReadonlyArray<{
    method: string;
    operation: keyof PiSessionProtocolFacade;
    payload: unknown;
  }> = [
    { method: "session.list", operation: "list", payload: {} },
    { method: "session.search", operation: "search", payload: { query: "needle" } },
    { method: "session.create", operation: "create", payload: { cwd: "/workspace" } },
    { method: "session.history", operation: "history", payload: { sessionId: "session-1" } },
    {
      method: "session.regenerate",
      operation: "regenerate",
      payload: {
        sessionId: "session-1",
        messageId: "message-1",
        requestId: "attachment-retry-1",
      },
    },
    {
      method: "session.resume",
      operation: "resume",
      payload: {
        sessionId: "session-1",
        checkpointId: "checkpoint-1",
        expectedLeafId: "leaf-1",
      },
    },
    {
      method: "session.selectBranch",
      operation: "selectBranch",
      payload: { sessionId: "session-1", leafId: "leaf-1" },
    },
    { method: "session.models", operation: "models", payload: { sessionId: "session-1" } },
    {
      method: "session.selectModel",
      operation: "selectModel",
      payload: { sessionId: "session-1", provider: "provider", model: "model" },
    },
    {
      method: "session.contextPolicy",
      operation: "contextPolicy",
      payload: { sessionId: "session-1" },
    },
    {
      method: "session.updateContextPolicy",
      operation: "updateContextPolicy",
      payload: { sessionId: "session-1", policy: { mode: "inherit" } },
    },
    {
      method: "session.compactContext",
      operation: "compactContext",
      payload: { sessionId: "session-1" },
    },
    {
      method: "session.rename",
      operation: "rename",
      payload: { sessionId: "session-1", title: "Renamed" },
    },
    { method: "session.delete", operation: "delete", payload: { sessionId: "session-1" } },
    { method: "session.fork", operation: "fork", payload: { sessionId: "session-1" } },
    {
      method: "session.scratch.create",
      operation: "scratchCreate",
      payload: { sourceSessionId: "session-1", atSeq: 4 },
    },
    {
      method: "session.scratch.release",
      operation: "scratchRelease",
      payload: { sessionId: "scratch-1" },
    },
    {
      method: "session.scratch.promote",
      operation: "scratchPromote",
      payload: { sessionId: "scratch-1", title: "Saved" },
    },
    {
      method: "session.prompt",
      operation: "prompt",
      payload: {
        sessionId: "session-1",
        mode: "queue",
        content: [{ type: "text", text: "Hello" }],
      },
    },
    {
      method: "session.attachment",
      operation: "attachment",
      payload: { sessionId: "session-1", attachmentId: "attachment-1" },
    },
    {
      method: "session.updateQueue",
      operation: "updateQueue",
      payload: { sessionId: "session-1", itemId: "queue-1", action: { kind: "remove" } },
    },
    { method: "session.cancel", operation: "cancel", payload: { sessionId: "session-1" } },
  ];

  for (const route of cases) {
    calls.length = 0;
    const response = sessionRoutes.handle(rpcRequest(route.method, route.payload), route.method);
    assert.ok(response, `Route was not claimed: ${route.method}`);
    await successValue(await response);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.operation, route.operation);
    assert.deepEqual(calls[0]?.args[0], route.payload);
    assert.equal(calls[0]?.args.length, route.operation === "prompt" ? 2 : 1);
  }
});

test("validates prompt payloads and forwards transport provenance to the protocol facade", async () => {
  const calls: unknown[] = [];
  const sessionRoutes = routes({
    prompt: async (payload, context) => {
      calls.push({ payload, context });
      return { accepted: true, queued: false };
    },
  });
  const response = sessionRoutes.handle(
    rpcRequest(
      "session.prompt",
      {
        sessionId: "session-1",
        mode: "queue",
        content: [{ type: "text", text: "Hello", ignored: true }],
        ignored: true,
      },
      "rpc-prompt",
    ),
    "session.prompt",
  );

  assert.ok(response);
  assert.deepEqual(await successValue(await response), { accepted: true, queued: false });
  assert.deepEqual(calls, [
    {
      payload: {
        sessionId: "session-1",
        mode: "queue",
        content: [{ type: "text", text: "Hello" }],
      },
      context: { rpcId: "rpc-prompt" },
    },
  ]);
});

test("keeps validation failures inside the RPC envelope before invoking the facade", async () => {
  let searchCalls = 0;
  const sessionRoutes = routes({
    search: async () => {
      searchCalls += 1;
      return { items: [], hasMore: false };
    },
  });
  const response = sessionRoutes.handle(
    rpcRequest("session.search", { query: 42 }),
    "session.search",
  );

  assert.ok(response);
  const body = (await (await response).json()) as ServerResponse<never, { issues: RpcIssue[] }>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected an RPC validation failure.");
  assert.equal(body.result.error.code, "bad-request");
  assert.deepEqual(body.result.error.details.issues[0]?.path, ["payload", "query"]);
  assert.equal(searchCalls, 0);
});

test("delegates protocol failures to the transport-owned domain error projector", async () => {
  const failure = new Error("session lookup failed");
  const sessionRoutes = createSessionRpcRoutes({
    protocol: protocol({
      search: async () => {
        throw failure;
      },
    }),
    projectDomainError(error): never {
      assert.equal(error, failure);
      throw rpcBusinessError("projected-session-error", "Projected session failure.", {
        stable: true,
      });
    },
  });
  const response = sessionRoutes.handle(
    rpcRequest("session.search", { query: "failure" }),
    "session.search",
  );

  assert.ok(response);
  const body = (await (await response).json()) as ServerResponse<never>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a projected RPC failure.");
  assert.deepEqual(body.result.error, {
    code: "projected-session-error",
    message: "Projected session failure.",
    details: { stable: true },
  });
});
