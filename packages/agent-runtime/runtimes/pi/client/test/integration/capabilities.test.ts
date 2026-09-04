import assert from "node:assert/strict";
import test from "node:test";

import { WorkbenchAgentCapabilityError } from "@workbench/agent-runtime-client/capabilities";
import type { WorkbenchContextPolicyValue } from "@workbench/agent-runtime-contracts/runtime-capabilities";

import {
  createPiAgentRuntimeCapabilities,
  projectPiCapabilityError,
} from "../../src/integration/capabilities";
import type { PiSessionManager } from "../../src/runtime/manager";
import { PiApiError, type PiHttpTransport } from "../../src/transport/api";

const contextValue: WorkbenchContextPolicyValue = {
  policy: { mode: "inherit" },
  overridden: false,
  compaction: { enabled: true, reserveTokens: 1_000, keepRecentTokens: 2_000 },
  usage: { tokens: 300, percent: 3 },
  nearingCompaction: false,
};

function transportFor(values: Readonly<Record<string, unknown>>): PiHttpTransport {
  return async (_path, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: values[request.method] },
    });
  };
}

function fixtureManager(): PiSessionManager {
  const transport = transportFor({
    "host.listDirectory": {
      path: "/workspace",
      home: "/home/test",
      crumbs: [{ name: "workspace", path: "/workspace", hidden: false }],
      entries: [],
      truncated: false,
    },
    "workspace.create": {
      workspace: {
        workspaceId: "workspace-1",
        title: "Workspace",
        path: "/workspace",
        sessionIds: [],
        createdAt: "2026-09-04T00:00:00.000Z",
        updatedAt: "2026-09-04T00:00:00.000Z",
      },
      created: true,
    },
    "llm.models": { groups: [], failures: [] },
    "automation.list": { items: [] },
    "imageUnderstanding.describe": {
      revision: 4,
      value: { routing: "disabled" },
    },
  });
  const interaction = {
    kind: "question" as const,
    rpcId: "request-1",
    sessionId: "session-1",
    questions: [{ id: "answer", question: "Continue?" }],
  };
  const session = {
    setDraftModelSelection: () => undefined,
    reload: async () => undefined,
  };

  return {
    rpcTransportOptions: { transport },
    modelCatalogInvalidation: {
      getRevision: () => 2,
      subscribe: () => () => undefined,
      getSessionSelectionRevision: () => 3,
      subscribeSessionSelection: () => () => undefined,
    },
    getSnapshot: () => 7,
    subscribe: () => () => undefined,
    getPendingInteractions: () => [interaction],
    respondInteraction: async () => ({ accepted: true as const }),
    createScratchSession: async ({ sourceSessionId }: { sourceSessionId: string }) => ({
      sessionId: "scratch-1",
      sourceSessionId,
      expiresAt: 100,
    }),
    restoreScratchSession: () => true,
    releaseScratchSession: async () => undefined,
    promoteScratchSession: async ({ sessionId }: { sessionId: string }) => ({
      sessionId,
      sourceSessionId: "session-1",
    }),
    contextPolicies: {
      getSnapshot: () => ({ status: "ready" as const, value: contextValue }),
      subscribe: () => () => undefined,
      load: async () => contextValue,
      update: async () => contextValue,
      compact: async () => contextValue,
    },
    selectSessionModel: async (selection: {
      provider: string;
      model: string;
      reasoningEffort?: string;
    }) => ({ selected: selection }),
    session: () => session,
  } as unknown as PiSessionManager;
}

test("projects every Pi implementation capability through the Workbench contract", async () => {
  const capabilities = createPiAgentRuntimeCapabilities(fixtureManager());
  assert.ok(capabilities.host);
  assert.ok(capabilities.workspace);
  assert.ok(capabilities.models);
  assert.ok(capabilities.interactions);
  assert.ok(capabilities.scratchSessions);
  assert.ok(capabilities.context);
  assert.ok(capabilities.automation);
  assert.ok(capabilities.attachmentUnderstanding);

  assert.equal((await capabilities.host.listDirectory()).path, "/workspace");
  assert.deepEqual(await capabilities.workspace.createWorkspace("/workspace"), {
    workspace: { id: "workspace-1", name: "Workspace", rootPath: "/workspace" },
    created: true,
  });
  assert.deepEqual(await capabilities.models.listCatalog(), { groups: [], failures: [] });
  assert.deepEqual(capabilities.interactions.getPendingInteractions(), [
    {
      kind: "question",
      requestId: "request-1",
      sessionId: "session-1",
      questions: [{ id: "answer", question: "Continue?" }],
    },
  ]);
  await capabilities.interactions.respondInteraction("request-1", {
    kind: "question",
    answers: [{ id: "answer", selected: ["yes"] }],
  });
  assert.equal(
    (await capabilities.scratchSessions.createScratchSession({ sourceSessionId: "session-1" }))
      .sessionId,
    "scratch-1",
  );
  assert.equal((await capabilities.context.load("session-1")).usage.tokens, 300);
  assert.deepEqual(await capabilities.automation.list({}), { items: [] });
  assert.equal((await capabilities.attachmentUnderstanding.describe()).revision, 4);
});

test("maps Pi implementation failures to stable Workbench capability errors", () => {
  const cases = [
    ["workspace-file-conflict", 409, "conflict"],
    ["agent-busy", 409, "busy"],
    ["directory-picker-unavailable", 501, "unavailable"],
    ["session-not-found", 404, "not-found"],
    ["pi_interaction_not_found", 404, "request-ended"],
    ["git-branch-invalid", 400, "invalid-request"],
    ["workspace_file_content_failed", 404, "not-found"],
  ] as const;

  for (const [piCode, status, expected] of cases) {
    const error = projectPiCapabilityError(new PiApiError(piCode, status, { marker: piCode }));
    assert.ok(error instanceof WorkbenchAgentCapabilityError);
    assert.equal(error.code, expected);
    assert.deepEqual(error.details, { marker: piCode });
  }

  assert.equal(
    projectPiCapabilityError(new PiApiError("pi_rpc_invalid_response", 200, { method: "x" })).code,
    "failed",
  );
  assert.equal(
    projectPiCapabilityError(new PiApiError("pi_rpc_transport_failed", 503, { method: "x" }))
      .details,
    undefined,
  );
});
