import assert from "node:assert/strict";
import test from "node:test";

import type { PiHttpTransport } from "@workbench/pi-rpc-client/api";

import {
  createPiRpcRemoteCommandRuntime,
  createRemoteCommandAdapter,
  RemoteCommandAdapterError,
  type RemoteCommandRuntimePort,
} from "../src/command-adapter.ts";
import { projectRemoteWorkspaceCatalog } from "../src/workspace-projection.ts";

function managedRuntime() {
  const calls: Array<{ readonly name: string; readonly value: unknown }> = [];
  const sessions = new Map([
    [
      "session-1",
      {
        sessionId: "session-1",
        title: "Original",
        pinned: false,
        archived: false,
        entityRevision: "revision-1",
      },
    ],
  ]);
  let revision = 1;
  const update = (
    sessionId: string,
    patch: Partial<{ title: string; pinned: boolean; archived: boolean }>,
  ) => {
    const current = sessions.get(sessionId);
    if (!current)
      throw Object.assign(new Error("operation_not_found"), { code: "operation_not_found" });
    revision += 1;
    const next = { ...current, ...patch, entityRevision: `revision-${revision}` };
    sessions.set(sessionId, next);
    return next;
  };
  const runtime: RemoteCommandRuntimePort = {
    history: async () => ({ events: [], hasMore: false }),
    prompt: async (input) => ({
      accepted: true,
      queued: false,
      messageId: input.clientMutation.messageId,
    }),
    cancel: async () => ({ accepted: true }),
    answerQuestion: async () => ({ accepted: true }),
    listWorkspaces: async () => [{ workspaceId: "workspace-known", displayName: "Known" }],
    getSessionState: async (sessionId) => sessions.get(sessionId),
    createSession: async (input) => {
      calls.push({ name: "create", value: input });
      sessions.set(input.requestedSessionId, {
        sessionId: input.requestedSessionId,
        title: "New session",
        pinned: false,
        archived: false,
        entityRevision: "revision-created",
      });
      return { sessionId: input.requestedSessionId };
    },
    renameSession: async (input) => {
      calls.push({ name: "rename", value: input });
      return update(input.sessionId, { title: input.title });
    },
    setSessionPinned: async (input) => {
      calls.push({ name: "pin", value: input });
      return update(input.sessionId, { pinned: input.pinned });
    },
    archiveSession: async (input) => {
      calls.push({ name: "archive", value: input });
      return update(input.sessionId, { archived: true });
    },
  };
  return { runtime, calls, sessions };
}

test("projects opaque workspaces with one explicit default and no local paths", () => {
  const projected = projectRemoteWorkspaceCatalog({
    workspaces: [
      {
        workspaceId: "workspace-1",
        title: "Workbench UI",
        path: "/Users/alice/source/workbench-ui",
        sessionIds: ["session-1"],
        createdAt: "2026-09-13T20:00:00.000Z",
        updatedAt: "2026-09-13T20:01:00.000Z",
      },
      {
        workspaceId: "workspace-2",
        title: "Second",
        rootPath: "C:\\private",
      },
    ],
    defaultWorkspaceId: "workspace-1",
  });
  assert.deepEqual(projected.items, [
    { workspaceId: "workspace-1", displayName: "Workbench UI", isDefault: true },
    { workspaceId: "workspace-2", displayName: "Second", isDefault: false },
  ]);
  assert.equal(JSON.stringify(projected).includes("/Users/alice"), false);
  assert.equal(JSON.stringify(projected).includes("C:\\private"), false);
});

test("maps only fixed-identity create and set-to-value management operations", async () => {
  const harness = managedRuntime();
  const adapter = createRemoteCommandAdapter({ runtime: harness.runtime });

  assert.deepEqual(
    await adapter.execute({
      operationId: "session-requested",
      requestedSessionId: "session-requested",
      command: {
        type: "session.create",
        workspaceId: "workspace-known",
        title: "Created remotely",
      },
    }),
    { type: "session-created", sessionId: "session-requested" },
  );
  assert.deepEqual(harness.calls.slice(0, 2), [
    {
      name: "create",
      value: { workspaceId: "workspace-known", requestedSessionId: "session-requested" },
    },
    {
      name: "rename",
      value: { sessionId: "session-requested", title: "Created remotely" },
    },
  ]);

  assert.deepEqual(
    await adapter.execute({
      operationId: "rename-1",
      command: { type: "session.rename", sessionId: "session-1", title: "Renamed" },
    }),
    { type: "session-state", sessionId: "session-1", entityRevision: "revision-3" },
  );
  assert.deepEqual(
    await adapter.execute({
      operationId: "pin-1",
      command: { type: "session.setPinned", sessionId: "session-1", pinned: true },
    }),
    { type: "session-state", sessionId: "session-1", entityRevision: "revision-4" },
  );
  assert.deepEqual(
    await adapter.execute({
      operationId: "archive-1",
      command: { type: "session.setArchived", sessionId: "session-1", archived: true },
    }),
    { type: "session-state", sessionId: "session-1", entityRevision: "revision-5" },
  );

  await assert.rejects(
    adapter.execute({
      operationId: "unknown-workspace",
      requestedSessionId: "unknown-workspace",
      command: { type: "session.create", workspaceId: "workspace-missing" },
    }),
    (error: unknown) =>
      error instanceof RemoteCommandAdapterError && error.code === "local_rejected",
  );
});

test("uses public Pi RPC methods and never calls unarchive or delete", async () => {
  const calls: Array<{ method: string; payload: unknown }> = [];
  const state = {
    title: "Original",
    pinned: false,
    archived: false,
    seq: 1,
  };
  const transport: PiHttpTransport = async (_path, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: Record<string, unknown>;
    };
    calls.push({ method: request.method, payload: request.payload });
    let value: unknown;
    switch (request.method) {
      case "workspace.list":
        value = {
          items: [
            {
              workspaceId: "workspace-known",
              path: "/private/work",
              title: "Known",
              sessionIds: ["session-1"],
              createdAt: "2026-09-13T20:00:00.000Z",
              updatedAt: "2026-09-13T20:01:00.000Z",
            },
          ],
          pinnedSessionIds: state.pinned ? ["session-1"] : [],
        };
        break;
      case "workspace.listArchivedSessions":
        value = { sessionIds: state.archived ? ["session-1"] : [] };
        break;
      case "session.list":
        value = {
          items: [
            {
              sessionId: "session-1",
              updatedAt: 1_778_000_000_000,
              running: false,
              blank: false,
              projections: {
                asOfSeq: state.seq,
                values: { "workbench.piSessionSummary": { name: state.title } },
              },
            },
          ],
        };
        break;
      case "session.create":
        value = { sessionId: String(request.payload.sessionId) };
        break;
      case "session.rename":
        state.title = String(request.payload.title);
        state.seq += 1;
        value = { title: state.title, seq: state.seq };
        break;
      case "workspace.setSessionPinned":
        state.pinned = Boolean(request.payload.pinned);
        value = { sessionId: request.payload.sessionId, pinned: state.pinned };
        break;
      case "workspace.archiveSession":
        state.archived = true;
        value = { sessionId: request.payload.sessionId, archived: true };
        break;
      default:
        throw new Error(`unexpected method: ${request.method}`);
    }
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value },
    });
  };
  const runtime = createPiRpcRemoteCommandRuntime(transport);

  assert.deepEqual(await runtime.listWorkspaces!(), [
    { workspaceId: "workspace-known", displayName: "Known" },
  ]);
  assert.deepEqual(
    await runtime.createSession!({
      workspaceId: "workspace-known",
      requestedSessionId: "session-fixed",
    }),
    { sessionId: "session-fixed" },
  );
  await runtime.renameSession!({ sessionId: "session-1", title: "Renamed" });
  await runtime.setSessionPinned!({ sessionId: "session-1", pinned: true });
  await runtime.archiveSession!({ sessionId: "session-1" });

  assert.deepEqual(
    calls
      .filter((call) =>
        [
          "session.create",
          "session.rename",
          "workspace.setSessionPinned",
          "workspace.archiveSession",
        ].includes(call.method),
      )
      .map((call) => call.method),
    ["session.create", "session.rename", "workspace.setSessionPinned", "workspace.archiveSession"],
  );
  assert.equal(
    calls.some(({ method }) => /unarchive|delete/iu.test(method)),
    false,
  );
});

test("the active session catalog excludes archived sessions", () => {
  const items = [
    {
      sessionId: "active",
      title: "Active",
      updatedAt: "2026-09-13T20:00:00.000Z",
      pinned: false,
      archived: false,
      attention: "none",
      runState: "idle",
      entityRevision: "revision-active",
    },
    {
      sessionId: "archived",
      title: "Archived",
      updatedAt: "2026-09-13T21:00:00.000Z",
      pinned: true,
      archived: true,
      attention: "none",
      runState: "idle",
      entityRevision: "revision-archived",
    },
  ] as const;
  return import("../src/session-catalog.ts").then(({ projectRemoteSessionCatalog }) => {
    assert.deepEqual(
      projectRemoteSessionCatalog({ sessions: items, workspaces: [] }).items.map(
        ({ sessionId }) => sessionId,
      ),
      ["active"],
    );
  });
});
