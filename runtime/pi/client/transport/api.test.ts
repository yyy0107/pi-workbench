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
  cancelPiModelProviderLogin,
  configurePiModelProvider,
  deletePiRpcSession,
  describePiPackageCatalog,
  describePiProjectTrust,
  describePiWorkspaceFile,
  describePiSettings,
  describeWorkbenchSettings,
  getPiModelContextWindow,
  getPiModelProviderLogin,
  installPiPackage,
  listPiArchivedWorkspaceSessions,
  listPiCommands,
  listPiExtensions,
  listInstalledPiPackages,
  listPiSkills,
  listPiWorkspaceFiles,
  listPiWorkspaces,
  openPiSettingsDocument,
  piWorkspaceFileContentUrl,
  PiApiError,
  pickPiHostDirectory,
  readPiWorkspaceFile,
  removePiModelProvider,
  respondPiModelProviderLogin,
  respondPiRpc,
  searchPiPackageCatalog,
  startPiModelProviderLogin,
  streamPiWorkspaceFileText,
  updatePiAgentSettings,
  updatePiProjectTrust,
  updateWorkbenchSettings,
  updatePiModelContextWindow,
  unarchivePiWorkspaceSession,
  writePiWorkspaceFile,
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

  assert.deepEqual(await callPiRpc("workspace.test", { extra: 1 }, { rpcId: "caller-owned-rpc" }), {
    accepted: true,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, "/api/workspace.test");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(requestBody(calls[0]!), {
    type: "client-request",
    rpcId: "caller-owned-rpc",
    method: "workspace.test",
    payload: { extra: 1 },
  });
});

test("workspace file helpers use the typed workspace.files RPC methods", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls: Array<{ method: string; payload: unknown }> = [];
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: unknown;
    };
    calls.push({ method: request.method, payload: request.payload });
    const value =
      request.method === "workspace.files.list"
        ? {
            workspaceId: "workspace-1",
            relativePath: "",
            absolutePath: "/work/project",
            entries: [],
            truncated: false,
          }
        : request.method === "workspace.files.describe"
          ? {
              workspaceId: "workspace-1",
              relativePath: "src/app.ts",
              absolutePath: "/work/project/src/app.ts",
              name: "app.ts",
              mediaType: "text/plain",
              encoding: "utf-8",
              version: "stat-sha256:version",
              size: 6,
              modifiedAt: 1,
            }
          : {
              workspaceId: "workspace-1",
              relativePath: "src/app.ts",
              absolutePath: "/work/project/src/app.ts",
              name: "app.ts",
              content: request.method === "workspace.files.write" ? "updated" : "source",
              encoding: "utf-8",
              version: "sha256:version",
              size: 6,
              modifiedAt: 1,
            };
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value },
    });
  };

  assert.equal(
    (await listPiWorkspaceFiles({ workspaceId: "workspace-1" })).absolutePath,
    "/work/project",
  );
  assert.equal(
    (
      await describePiWorkspaceFile({
        workspaceId: "workspace-1",
        relativePath: "src/app.ts",
      })
    ).mediaType,
    "text/plain",
  );
  assert.equal(
    piWorkspaceFileContentUrl({ workspaceId: "workspace-1", relativePath: "src/app.ts" }),
    "/api/workspace.files.content?workspaceId=workspace-1&relativePath=src%2Fapp.ts",
  );
  assert.equal(
    (
      await readPiWorkspaceFile({
        workspaceId: "workspace-1",
        relativePath: "src/app.ts",
      })
    ).content,
    "source",
  );
  assert.equal(
    (
      await writePiWorkspaceFile({
        workspaceId: "workspace-1",
        relativePath: "src/app.ts",
        content: "updated",
        expectedVersion: "sha256:old",
      })
    ).content,
    "updated",
  );
  assert.deepEqual(calls, [
    { method: "workspace.files.list", payload: { workspaceId: "workspace-1" } },
    {
      method: "workspace.files.describe",
      payload: { workspaceId: "workspace-1", relativePath: "src/app.ts" },
    },
    {
      method: "workspace.files.read",
      payload: { workspaceId: "workspace-1", relativePath: "src/app.ts" },
    },
    {
      method: "workspace.files.write",
      payload: {
        workspaceId: "workspace-1",
        relativePath: "src/app.ts",
        content: "updated",
        expectedVersion: "sha256:old",
      },
    },
  ]);
});

test("streams UTF-8 workspace text incrementally across byte boundaries", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const bytes = new TextEncoder().encode("first\n雪\nlast");
  const chunks = [bytes.subarray(0, 7), bytes.subarray(7, 8), bytes.subarray(8)];
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
      { headers: { "content-length": String(bytes.byteLength) } },
    );

  const received: string[] = [];
  const progress: number[] = [];
  const result = await streamPiWorkspaceFileText(
    { workspaceId: "workspace-1", relativePath: "notes.txt" },
    {
      onChunk(chunk) {
        received.push(chunk.text);
        progress.push(chunk.loadedBytes);
        assert.equal(chunk.totalBytes, bytes.byteLength);
      },
    },
  );

  assert.equal(received.join(""), "first\n雪\nlast");
  assert.deepEqual(progress, [7, 8, bytes.byteLength]);
  assert.deepEqual(result, { loadedBytes: bytes.byteLength, totalBytes: bytes.byteLength });
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

test("provider account-login helpers use typed RPC methods and invalidate on completion", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const requests: Array<{ method: string; payload: unknown }> = [];
  const initialRevision = getPiModelCatalogRevision();
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: unknown;
    };
    requests.push({ method: request.method, payload: request.payload });
    const status = request.method === "llm.providerLogin" ? "complete" : "running";
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: {
          loginId: "login-1",
          provider: "openai-codex",
          authType: "oauth",
          status,
          revision: requests.length,
          events: [],
        },
      },
    });
  };

  await startPiModelProviderLogin({ provider: "openai-codex", authType: "oauth" });
  await respondPiModelProviderLogin({
    loginId: "login-1",
    promptId: "prompt-1",
    value: "browser",
  });
  await cancelPiModelProviderLogin({ loginId: "login-1" });
  await getPiModelProviderLogin({ loginId: "login-1" });

  assert.equal(getPiModelCatalogRevision(), initialRevision + 1);
  assert.deepEqual(requests, [
    {
      method: "llm.startProviderLogin",
      payload: { provider: "openai-codex", authType: "oauth" },
    },
    {
      method: "llm.respondProviderLogin",
      payload: { loginId: "login-1", promptId: "prompt-1", value: "browser" },
    },
    { method: "llm.cancelProviderLogin", payload: { loginId: "login-1" } },
    { method: "llm.providerLogin", payload: { loginId: "login-1" } },
  ]);
});

test("Pi agent settings helpers use the shared Settings RPC methods", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const methods: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: unknown;
    };
    methods.push(request.method);
    const namespace = {
      ns: "pi.agent" as const,
      schema: {},
      value: {
        systemPrompt: "",
        compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
      },
      applies: "restart" as const,
      secrets: [],
      revision: 12,
    };
    const value =
      request.method === "settings.describe"
        ? { writable: true, hasDocument: false, namespaces: [namespace] }
        : request.method === "settings.openDocument"
          ? { opened: true }
          : namespace;
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: {
        ok: true,
        value,
      },
    });
  };

  assert.equal((await describePiSettings()).namespaces[0]?.revision, 12);
  assert.deepEqual(await openPiSettingsDocument(), { opened: true });
  assert.equal(
    (
      await updatePiAgentSettings({
        ns: "pi.agent",
        patch: { compaction: { enabled: false } },
        expectedRevision: 12,
      })
    ).value.compaction.enabled,
    true,
  );
  assert.deepEqual(methods, ["settings.describe", "settings.openDocument", "settings.update"]);
});

test("Workbench settings helpers use the shared Workbench Settings RPC methods", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const requests: Array<{ method: string; payload: unknown }> = [];
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: unknown;
    };
    requests.push({ method: request.method, payload: request.payload });
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: {
        ok: true,
        value:
          request.method === "workbenchSettings.describe"
            ? { revision: 4, preferences: { locale: "zh-CN" } }
            : { revision: 5 },
      },
    });
  };

  assert.equal((await describeWorkbenchSettings()).preferences.locale, "zh-CN");
  assert.deepEqual(await updateWorkbenchSettings({ patch: { sidebarOpen: false } }), {
    revision: 5,
  });
  assert.deepEqual(requests, [
    { method: "workbenchSettings.describe", payload: {} },
    { method: "workbenchSettings.update", payload: { patch: { sidebarOpen: false } } },
  ]);
});

test("model context-window helpers use typed LLM RPC methods", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const requests: Array<{ method: string; payload: unknown }> = [];
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: unknown;
    };
    requests.push({ method: request.method, payload: request.payload });
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: {
          provider: "openai",
          model: "gpt-5",
          name: "GPT-5",
          contextWindow: request.method === "llm.updateModelContextWindow" ? 256_000 : 200_000,
        },
      },
    });
  };

  assert.equal(
    (
      await getPiModelContextWindow({
        provider: "openai",
        model: "gpt-5",
      })
    ).contextWindow,
    200_000,
  );
  assert.equal(
    (
      await updatePiModelContextWindow({
        provider: "openai",
        model: "gpt-5",
        contextWindow: 256_000,
      })
    ).contextWindow,
    256_000,
  );
  assert.deepEqual(requests, [
    {
      method: "llm.modelContextWindow",
      payload: { provider: "openai", model: "gpt-5" },
    },
    {
      method: "llm.updateModelContextWindow",
      payload: { provider: "openai", model: "gpt-5", contextWindow: 256_000 },
    },
  ]);
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

test("workspace admission helpers keep picking and project trust as explicit RPC steps", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls: Array<{ method: string; payload: unknown }> = [];
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: unknown;
    };
    calls.push({ method: request.method, payload: request.payload });
    const value =
      request.method === "host.pickDirectory"
        ? { path: "/work/project" }
        : {
            path: "/work/project",
            requiresTrust: true,
            trusted: request.method === "projectTrust.update" ? true : null,
            promptRequired: request.method !== "projectTrust.update",
            ...(request.method === "projectTrust.update" ? { decisionPath: "/work/project" } : {}),
          };
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value },
    });
  };

  assert.equal(await pickPiHostDirectory(), "/work/project");
  assert.equal((await describePiProjectTrust({ path: "/work/project" })).promptRequired, true);
  assert.equal(
    (await updatePiProjectTrust({ path: "/work/project", trusted: true })).trusted,
    true,
  );
  assert.deepEqual(calls, [
    { method: "host.pickDirectory", payload: {} },
    { method: "projectTrust.describe", payload: { path: "/work/project" } },
    {
      method: "projectTrust.update",
      payload: { path: "/work/project", trusted: true },
    },
  ]);
});

test("workspace list helpers keep visible and archived sessions in separate RPCs", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const methods: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
    methods.push(request.method);
    const value =
      request.method === "workspace.list" ? { items: [] } : { sessionIds: ["archived-session"] };
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value },
    });
  };

  assert.deepEqual(await listPiWorkspaces(), { items: [] });
  assert.deepEqual(await listPiArchivedWorkspaceSessions(), {
    sessionIds: ["archived-session"],
  });
  assert.deepEqual(methods, ["workspace.list", "workspace.listArchivedSessions"]);
});

test("unarchivePiWorkspaceSession uses the durable workspace mutation RPC", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let method = "";
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: unknown;
    };
    method = request.method;
    assert.deepEqual(request.payload, { sessionId: "session-1" });
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: {
          sessionId: "session-1",
          archived: false,
        },
      },
    });
  };

  assert.deepEqual(await unarchivePiWorkspaceSession("session-1"), {
    sessionId: "session-1",
    archived: false,
  });
  assert.equal(method, "workspace.unarchiveSession");
});

test("deletePiRpcSession uses the typed session.delete RPC", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let method = "";
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: unknown;
    };
    method = request.method;
    assert.deepEqual(request.payload, { sessionId: "session-1" });
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: { deleted: true } },
    });
  };

  assert.deepEqual(await deletePiRpcSession({ sessionId: "session-1" }), { deleted: true });
  assert.equal(method, "session.delete");
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

test("listPiCommands calls the session-scoped command.list RPC", async (t) => {
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
          commands: [
            {
              kind: "extension",
              name: "review",
              invocationName: "review",
              effect: "agent-turn",
              exclusive: true,
              description: "Review the current changes.",
              source: "auto",
              scope: "user",
              origin: "top-level",
            },
          ],
        },
      },
    });
  };

  assert.deepEqual(await listPiCommands({ sessionId: "session-1" }), {
    commands: [
      {
        kind: "extension",
        name: "review",
        invocationName: "review",
        effect: "agent-turn",
        exclusive: true,
        description: "Review the current changes.",
        source: "auto",
        scope: "user",
        origin: "top-level",
      },
    ],
  });
  assert.equal(request?.method, "command.list");
  assert.deepEqual(request?.payload, { sessionId: "session-1" });
});

test("listPiExtensions calls the session-scoped extension.list RPC", async (t) => {
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
          extensions: [
            {
              name: "review",
              source: "auto",
              scope: "user",
              origin: "top-level",
              eventNames: ["tool_call"],
              toolNames: ["review_changes"],
              commandNames: ["review"],
            },
          ],
          loadErrorCount: 0,
        },
      },
    });
  };

  assert.deepEqual(await listPiExtensions({ sessionId: "session-1" }), {
    extensions: [
      {
        name: "review",
        source: "auto",
        scope: "user",
        origin: "top-level",
        eventNames: ["tool_call"],
        toolNames: ["review_changes"],
        commandNames: ["review"],
      },
    ],
    loadErrorCount: 0,
  });
  assert.equal(request?.method, "extension.list");
  assert.deepEqual(request?.payload, { sessionId: "session-1" });
});

test("listInstalledPiPackages calls the session-scoped package.list RPC", async (t) => {
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
          packages: [
            { source: "npm:pi-review", scope: "user", filtered: false },
            { source: "git:github.com/example/pi-tools", scope: "project", filtered: true },
          ],
        },
      },
    });
  };

  assert.deepEqual(await listInstalledPiPackages({ sessionId: "session-1" }), {
    packages: [
      { source: "npm:pi-review", scope: "user", filtered: false },
      { source: "git:github.com/example/pi-tools", scope: "project", filtered: true },
    ],
  });
  assert.equal(request?.method, "package.list");
  assert.deepEqual(request?.payload, { sessionId: "session-1" });
});

test("installPiPackage calls the loopback package.install RPC", async (t) => {
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
          source: "npm:@example/pi-tools",
          scope: "project",
          workspaceId: "workspace-1",
          reloadRequired: true,
        },
      },
    });
  };

  assert.deepEqual(
    await installPiPackage({
      name: "@example/pi-tools",
      target: { scope: "project", workspaceId: "workspace-1" },
    }),
    {
      source: "npm:@example/pi-tools",
      scope: "project",
      workspaceId: "workspace-1",
      reloadRequired: true,
    },
  );
  assert.equal(request?.method, "package.install");
  assert.deepEqual(request?.payload, {
    name: "@example/pi-tools",
    target: { scope: "project", workspaceId: "workspace-1" },
  });
});

test("searchPiPackageCatalog calls the official package-catalog RPC", async (t) => {
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
          sourceUrl: "https://pi.dev/packages",
          page: 1,
          pageSize: 50,
          pageCount: 1,
          filteredTotal: 1,
          total: 5439,
          packages: [],
        },
      },
    });
  };

  assert.deepEqual(await searchPiPackageCatalog({ query: "review", type: "skill" }), {
    sourceUrl: "https://pi.dev/packages",
    page: 1,
    pageSize: 50,
    pageCount: 1,
    filteredTotal: 1,
    total: 5439,
    packages: [],
  });
  assert.equal(request?.method, "packageCatalog.search");
  assert.deepEqual(request?.payload, { query: "review", type: "skill" });
});

test("describePiPackageCatalog calls the official package-detail RPC", async (t) => {
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
          name: "@example/pi-tools",
          version: "1.2.3",
          types: ["extension"],
          weeklyDownloads: 500,
          manifestJson: "{}",
        },
      },
    });
  };

  assert.deepEqual(await describePiPackageCatalog({ name: "@example/pi-tools" }), {
    name: "@example/pi-tools",
    version: "1.2.3",
    types: ["extension"],
    weeklyDownloads: 500,
    manifestJson: "{}",
  });
  assert.equal(request?.method, "packageCatalog.describe");
  assert.deepEqual(request?.payload, { name: "@example/pi-tools" });
});
