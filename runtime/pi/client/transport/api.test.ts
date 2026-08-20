import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      !/\.[^/]+$/.test(specifier) &&
      context.parentURL?.includes("/runtime/pi/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const {
  callPiRpc,
  configurePiModelProvider,
  listPiSkills,
  PiApiError,
  pickPiWorkspace,
  removePiModelProvider,
  respondPiRpc,
} = (await import(new URL("./api.ts", import.meta.url).href)) as typeof import("./api");
const { getPiModelCatalogRevision, subscribePiModelCatalogInvalidation } = (await import(
  new URL("../models/model-catalog-invalidation.ts", import.meta.url).href
)) as typeof import("../models/model-catalog-invalidation");
moduleHooks.deregister();

type FetchCall = { input: string | URL | Request; init?: RequestInit };

function requestBody(call: FetchCall): Record<string, unknown> {
  const body = call.init?.body;
  if (typeof body !== "string") assert.fail("Expected a JSON request body");
  return JSON.parse(body) as Record<string, unknown>;
}

test("callPiRpc sends and verifies the shared RPC envelope", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls: FetchCall[] = [];
  globalThis.fetch = async (input, init) => {
    const call = { input, init };
    calls.push(call);
    const body = requestBody(call);
    return Response.json({
      type: "server-response",
      rpcId: body.rpcId,
      result: { ok: true, value: { accepted: true } },
    });
  };

  assert.deepEqual(await callPiRpc("workspace.test", { extra: 1 }), { accepted: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, "/api/workspace.test");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(requestBody(calls[0]!), {
    type: "client-request",
    rpcId: requestBody(calls[0]!).rpcId,
    method: "workspace.test",
    payload: { extra: 1 },
  });
});

test("callPiRpc exposes structured business errors", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_input, init) => {
    const rpcId = JSON.parse(String(init?.body)).rpcId as string;
    return Response.json({
      type: "server-response",
      rpcId,
      result: {
        ok: false,
        error: {
          code: "workspace-not-found",
          message: "Workspace not found",
          details: { workspaceId: "missing" },
        },
      },
    });
  };

  await assert.rejects(callPiRpc("workspace.delete", { workspaceId: "missing" }), (error) => {
    assert.ok(error instanceof PiApiError);
    assert.equal(error.code, "workspace-not-found");
    assert.equal(error.status, 200);
    assert.deepEqual(error.details, { workspaceId: "missing" });
    return true;
  });
});

test("successful provider mutations invalidate the shared model catalog", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let notifications = 0;
  const unsubscribe = subscribePiModelCatalogInvalidation(() => {
    notifications += 1;
  });
  t.after(unsubscribe);
  const initialRevision = getPiModelCatalogRevision();
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string };
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: { providers: [] } },
    });
  };

  await configurePiModelProvider({ provider: "acme", apiKey: "private-key" });
  assert.equal(getPiModelCatalogRevision(), initialRevision + 1);
  assert.equal(notifications, 1);

  await removePiModelProvider({ provider: "acme" });
  assert.equal(getPiModelCatalogRevision(), initialRevision + 2);
  assert.equal(notifications, 2);

  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string };
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: {
        ok: false,
        error: { code: "save-failed", message: "Save failed", details: {} },
      },
    });
  };
  await assert.rejects(configurePiModelProvider({ provider: "acme", apiKey: "private-key" }));
  assert.equal(getPiModelCatalogRevision(), initialRevision + 2);
  assert.equal(notifications, 2);
});

test("callPiRpc rejects malformed success and failure envelopes", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const malformed = [
    null,
    { type: "not-a-server-response", result: { ok: true, value: 1 } },
    { type: "server-response", result: [] },
    { type: "server-response", result: { ok: "yes" } },
    { type: "server-response", result: { ok: false } },
    {
      type: "server-response",
      result: { ok: false, error: { code: "bad", message: "bad", details: [] } },
    },
  ];

  for (const candidate of malformed) {
    globalThis.fetch = async (_input, init) => {
      const rpcId = JSON.parse(String(init?.body)).rpcId as string;
      const body = candidate && typeof candidate === "object" ? { ...candidate, rpcId } : candidate;
      return Response.json(body);
    };
    await assert.rejects(callPiRpc("workspace.test", {}), (error) => {
      assert.ok(error instanceof PiApiError);
      assert.equal(error.code, "pi_rpc_invalid_response");
      return true;
    });
  }
});

test("respondPiRpc preserves the server-request rpcId and validates carrier receipts", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls: FetchCall[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ input, init });
    return Response.json(
      calls.length === 1 ? { accepted: true } : { accepted: false, reason: "not-pending" },
    );
  };
  const response = {
    type: "client-response" as const,
    rpcId: "question-rpc",
    result: {
      ok: true as const,
      value: {
        sessionId: "session-1",
        answer: { answers: [{ id: "target", selected: ["Code"] }] },
      },
    },
  };
  assert.deepEqual(await respondPiRpc(response), { accepted: true });
  assert.deepEqual(await respondPiRpc(response), { accepted: false, reason: "not-pending" });
  assert.equal(calls[0]?.input, "/api/respond");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(requestBody(calls[0]!), response);

  for (const invalid of [null, {}, { accepted: false, reason: "unknown" }]) {
    globalThis.fetch = async () => Response.json(invalid);
    await assert.rejects(respondPiRpc(response), (error) => {
      assert.ok(error instanceof PiApiError);
      assert.equal(error.code, "pi_rpc_invalid_response");
      return true;
    });
  }
});

test("pickPiWorkspace composes host.pickDirectory and workspace.create", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const methods: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
    methods.push(request.method);
    const value =
      request.method === "host.pickDirectory"
        ? { path: "/work/project" }
        : {
            workspace: {
              workspaceId: "workspace-1",
              path: "/work/project",
              title: "project",
              sessionIds: [],
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            created: true,
          };
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value },
    });
  };

  assert.deepEqual(await pickPiWorkspace(), {
    id: "workspace-1",
    name: "project",
    cwd: "/work/project",
  });
  assert.deepEqual(methods, ["host.pickDirectory", "workspace.create"]);
});

test("listPiSkills calls the session-scoped skill.list RPC", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let request: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: {
          skills: [
            {
              name: "review",
              description: "Review changes.",
              modelInvocable: true,
            },
          ],
        },
      },
    });
  };

  assert.deepEqual(await listPiSkills({ sessionId: "session-1" }), {
    skills: [{ name: "review", description: "Review changes.", modelInvocable: true }],
  });
  assert.equal(request?.method, "skill.list");
  assert.deepEqual(request?.payload, { sessionId: "session-1" });
});
