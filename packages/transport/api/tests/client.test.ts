import assert from "node:assert/strict";
import test from "node:test";

import { callRpc, createRpcId, RpcClientError, type RpcTransport } from "../src/client.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("posts the RPC request envelope with the provided ID and signal", async () => {
  const controller = new AbortController();
  let request: { path: string; init?: RequestInit } | undefined;
  const transport: RpcTransport = async (path, init) => {
    request = { path, init };
    return jsonResponse({
      type: "server-response",
      rpcId: "rpc-1",
      result: { ok: true, value: { saved: true } },
    });
  };

  const value = await callRpc<{ name: string }, { saved: boolean }>(
    "save-settings",
    { name: "Workbench" },
    { transport, rpcId: "rpc-1", signal: controller.signal },
  );

  assert.deepEqual(value, { saved: true });
  assert.equal(request?.path, "/api/save-settings");
  assert.equal(request?.init?.method, "POST");
  assert.deepEqual(request?.init?.headers, { "Content-Type": "application/json" });
  assert.equal(request?.init?.signal, controller.signal);
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    type: "client-request",
    rpcId: "rpc-1",
    method: "save-settings",
    payload: { name: "Workbench" },
  });
});

test("creates an ID when the caller does not provide one", async () => {
  let capturedRpcId: string | undefined;
  const transport: RpcTransport = async (_path, init) => {
    capturedRpcId = (JSON.parse(String(init?.body)) as { rpcId: string }).rpcId;
    return jsonResponse({
      type: "server-response",
      rpcId: capturedRpcId,
      result: { ok: true, value: "ok" },
    });
  };

  assert.equal(await callRpc("status", {}, { transport }), "ok");
  assert.equal(typeof capturedRpcId, "string");
  assert.ok(capturedRpcId && capturedRpcId.length > 0);
  assert.equal(typeof createRpcId("status"), "string");
});

test("returns undefined from a successful response that omits value", async () => {
  const transport: RpcTransport = async () =>
    jsonResponse({
      type: "server-response",
      rpcId: "rpc-undefined",
      result: { ok: true },
    });

  assert.equal(await callRpc("void-method", {}, { transport, rpcId: "rpc-undefined" }), undefined);
});

test("reports non-success HTTP responses without parsing their body", async () => {
  const response = new Response("not json", { status: 503 });
  const transport: RpcTransport = async () => response;

  await assert.rejects(callRpc("status", {}, { transport, rpcId: "rpc-1" }), (error) => {
    assert.ok(error instanceof RpcClientError);
    assert.equal(error.name, "RpcClientError");
    assert.equal(error.code, "rpc_transport_failed");
    assert.equal(error.status, 503);
    assert.deepEqual(error.details, { method: "status" });
    assert.equal(error.message, "rpc_transport_failed");
    return true;
  });
  assert.equal(response.bodyUsed, false);
});

test("rejects invalid JSON as an invalid RPC response", async () => {
  const transport: RpcTransport = async () => new Response("not json", { status: 200 });

  await assert.rejects(
    callRpc("status", {}, { transport, rpcId: "rpc-1" }),
    (error: unknown) =>
      error instanceof RpcClientError &&
      error.code === "rpc_invalid_response" &&
      error.status === 200 &&
      error.details.method === "status",
  );
});

test("rejects malformed envelopes, mismatched IDs, and invalid result discriminators", async () => {
  const invalidBodies = [
    null,
    {},
    { type: "other", rpcId: "rpc-1", result: { ok: true, value: 1 } },
    { type: "server-response", rpcId: "rpc-other", result: { ok: true, value: 1 } },
    { type: "server-response", rpcId: "rpc-1", result: null },
    { type: "server-response", rpcId: "rpc-1", result: {} },
    { type: "server-response", rpcId: "rpc-1", result: { ok: "true", value: 1 } },
  ];

  for (const body of invalidBodies) {
    const transport: RpcTransport = async () => jsonResponse(body);
    await assert.rejects(
      callRpc("status", {}, { transport, rpcId: "rpc-1" }),
      (error: unknown) => error instanceof RpcClientError && error.code === "rpc_invalid_response",
    );
  }
});

test("preserves valid business error code, message, details, and HTTP status", async () => {
  const details = { resourceId: "resource-1", retryable: false };
  const transport: RpcTransport = async () =>
    jsonResponse({
      type: "server-response",
      rpcId: "rpc-1",
      result: {
        ok: false,
        error: { code: "resource-missing", message: "Resource missing", details },
      },
    });

  await assert.rejects(callRpc("load", {}, { transport, rpcId: "rpc-1" }), (error) => {
    assert.ok(error instanceof RpcClientError);
    assert.equal(error.code, "resource-missing");
    assert.equal(error.message, "Resource missing");
    assert.equal(error.status, 200);
    assert.deepEqual(error.details, details);
    return true;
  });
});

test("rejects malformed business errors as invalid RPC responses", async () => {
  const invalidErrors = [
    null,
    {},
    { code: 1, message: "failed", details: {} },
    { code: "failed", message: 1, details: {} },
    { code: "failed", message: "failed", details: null },
    { code: "failed", message: "failed", details: [] },
  ];

  for (const error of invalidErrors) {
    const transport: RpcTransport = async () =>
      jsonResponse({
        type: "server-response",
        rpcId: "rpc-1",
        result: { ok: false, error },
      });
    await assert.rejects(
      callRpc("status", {}, { transport, rpcId: "rpc-1" }),
      (caught: unknown) =>
        caught instanceof RpcClientError && caught.code === "rpc_invalid_response",
    );
  }
});

test("preserves transport rejection identity for aborts and other failures", async () => {
  const abort = new DOMException("aborted", "AbortError");
  const failure = new Error("connection failed");

  for (const rejection of [abort, failure]) {
    const transport: RpcTransport = async () => {
      throw rejection;
    };
    await assert.rejects(
      callRpc("status", {}, { transport, rpcId: "rpc-1" }),
      (error: unknown) => error === rejection,
    );
  }
});
