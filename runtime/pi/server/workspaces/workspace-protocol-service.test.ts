import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceView } from "@/runtime/pi/contracts/rpc";
import {
  createWorkspaceProtocolService,
  WorkspaceProtocolServiceError,
  type WorkspaceProtocolServiceDependencies,
  type WorkspaceProtocolStore,
} from "./workspace-protocol-service";
import type { WorkspaceListResult } from "./workspace-store";

const workspace: WorkspaceView = {
  workspaceId: "workspace-1",
  path: "/projects/one",
  title: "One",
  sessionIds: ["session-1"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const workspaceListResult = (
  overrides: Partial<WorkspaceListResult> = {},
): WorkspaceListResult => ({
  items: [workspace],
  archivedSessionIds: ["session-archived"],
  pinnedWorkspaceIds: ["workspace-1"],
  pinnedSessionIds: ["session-1"],
  ...overrides,
});

function protocolStore(overrides: Partial<WorkspaceProtocolStore>): WorkspaceProtocolStore {
  return new Proxy(overrides, {
    get(target, property, receiver) {
      const implementation = Reflect.get(target, property, receiver);
      if (implementation !== undefined) return implementation;
      return async () => {
        throw new Error(`Unexpected Workspace store call: ${String(property)}`);
      };
    },
  }) as WorkspaceProtocolStore;
}

function dependencies(
  overrides: Partial<WorkspaceProtocolServiceDependencies>,
): WorkspaceProtocolServiceDependencies {
  return {
    resolveWorkspaceStore: () => protocolStore({}),
    sessions: { list: async () => [] },
    projectTrust: { trustExistingProjects: () => undefined },
    resourceContexts: { invalidateProject: () => undefined },
    ...overrides,
  };
}

test("lists Workspaces after reconciling the authoritative Session catalog and migrating trust", async () => {
  const calls: Array<{ operation: string; value?: unknown }> = [];
  const store = protocolStore({
    async reconcileSessions(sessions) {
      calls.push({ operation: "reconcile", value: sessions });
      return workspaceListResult();
    },
    async migrateExistingProjectTrust(migrate) {
      calls.push({ operation: "migrate" });
      await migrate(["/projects/one"]);
      return workspaceListResult();
    },
  });
  const service = createWorkspaceProtocolService(
    dependencies({
      resolveWorkspaceStore: () => store,
      sessions: {
        async list() {
          calls.push({ operation: "catalog" });
          return [{ id: "session-1", cwd: "/projects/one" }];
        },
      },
      projectTrust: {
        trustExistingProjects(paths) {
          calls.push({ operation: "trust", value: paths });
        },
      },
    }),
  );

  assert.deepEqual(await service.list(), {
    items: [workspace],
    pinnedWorkspaceIds: ["workspace-1"],
    pinnedSessionIds: ["session-1"],
  });
  assert.deepEqual(calls, [
    { operation: "catalog" },
    {
      operation: "reconcile",
      value: [{ id: "session-1", cwd: "/projects/one" }],
    },
    { operation: "migrate" },
    { operation: "trust", value: ["/projects/one"] },
  ]);
});

test("runs the compatibility Trust migration before create and authoritative unarchive mutations", async () => {
  const calls: Array<{ operation: string; value?: unknown }> = [];
  const store = protocolStore({
    async migrateExistingProjectTrust(migrate) {
      calls.push({ operation: "migrate" });
      await migrate(["/projects/existing"]);
      return workspaceListResult();
    },
    async create(input) {
      calls.push({ operation: "create", value: input });
      return { workspace, created: true };
    },
    async unarchiveSession(session) {
      calls.push({ operation: "unarchive", value: session });
      return { sessionId: session.id, archived: false };
    },
  });
  const service = createWorkspaceProtocolService(
    dependencies({
      resolveWorkspaceStore: () => store,
      sessions: {
        async list() {
          calls.push({ operation: "catalog" });
          return [{ id: "session-1", cwd: "/authoritative/project" }];
        },
      },
      projectTrust: {
        trustExistingProjects(paths) {
          calls.push({ operation: "trust", value: paths });
        },
      },
    }),
  );

  assert.deepEqual(await service.create({ path: "/projects/new" }), {
    workspace,
    created: true,
  });
  assert.deepEqual(await service.unarchiveSession({ sessionId: "session-1" }), {
    sessionId: "session-1",
    archived: false,
  });
  assert.deepEqual(calls, [
    { operation: "migrate" },
    { operation: "trust", value: ["/projects/existing"] },
    { operation: "create", value: { path: "/projects/new" } },
    { operation: "catalog" },
    { operation: "migrate" },
    { operation: "trust", value: ["/projects/existing"] },
    {
      operation: "unarchive",
      value: { id: "session-1", cwd: "/authoritative/project" },
    },
  ]);
});

test("rejects Session organization mutations before resolving or mutating the Workspace store", async () => {
  let storeResolutions = 0;
  const service = createWorkspaceProtocolService(
    dependencies({
      resolveWorkspaceStore() {
        storeResolutions += 1;
        return protocolStore({});
      },
      sessions: { list: async () => [] },
    }),
  );

  for (const operation of [
    () => service.setSessionPinned({ sessionId: "missing", pinned: true }),
    () => service.archiveSession({ sessionId: "missing" }),
    () => service.unarchiveSession({ sessionId: "missing" }),
  ]) {
    await assert.rejects(operation, (error: unknown) => {
      assert.ok(error instanceof WorkspaceProtocolServiceError);
      assert.equal(error.code, "session-not-found");
      assert.deepEqual(error.details, { sessionId: "missing" });
      return true;
    });
  }
  assert.equal(storeResolutions, 0);
});

test("delegates organization mutations and invalidates project resources only after deletion", async () => {
  const calls: Array<{ operation: PropertyKey; args: unknown[] }> = [];
  const results: Partial<Record<keyof WorkspaceProtocolStore, unknown>> = {
    list: workspaceListResult(),
    rename: { workspace },
    delete: { deleted: true },
    insertBefore: { workspaceIds: ["workspace-1"] },
    insertSessionBefore: { workspace },
    setPinned: { workspaceId: "workspace-1", pinned: true },
    setSessionPinned: { sessionId: "session-1", pinned: true },
    archiveSession: { sessionId: "session-1", archived: true },
  };
  const store = new Proxy(
    {},
    {
      get(_target, operation: keyof WorkspaceProtocolStore) {
        return async (...args: unknown[]) => {
          calls.push({ operation, args });
          return results[operation];
        };
      },
    },
  ) as WorkspaceProtocolStore;
  const invalidated: string[] = [];
  const service = createWorkspaceProtocolService(
    dependencies({
      resolveWorkspaceStore: () => store,
      sessions: { list: async () => [{ id: "session-1", cwd: "/projects/one" }] },
      resourceContexts: {
        invalidateProject(workspaceId) {
          invalidated.push(workspaceId);
        },
      },
    }),
  );

  assert.deepEqual(await service.listArchivedSessions(), {
    sessionIds: ["session-archived"],
  });
  await service.rename({ workspaceId: "workspace-1", title: "Renamed" });
  await service.insertBefore({ workspaceId: "workspace-1" });
  await service.insertSessionBefore({ workspaceId: "workspace-1", sessionId: "session-1" });
  await service.setPinned({ workspaceId: "workspace-1", pinned: true });
  await service.setSessionPinned({ sessionId: "session-1", pinned: true });
  await service.archiveSession({ sessionId: "session-1" });
  await service.delete({ workspaceId: "workspace-1" });

  assert.deepEqual(calls, [
    { operation: "list", args: [] },
    {
      operation: "rename",
      args: [{ workspaceId: "workspace-1", title: "Renamed" }],
    },
    { operation: "insertBefore", args: [{ workspaceId: "workspace-1" }] },
    {
      operation: "insertSessionBefore",
      args: [{ workspaceId: "workspace-1", sessionId: "session-1" }],
    },
    {
      operation: "setPinned",
      args: [{ workspaceId: "workspace-1", pinned: true }],
    },
    {
      operation: "setSessionPinned",
      args: [{ sessionId: "session-1", pinned: true }],
    },
    { operation: "archiveSession", args: [{ sessionId: "session-1" }] },
    { operation: "delete", args: [{ workspaceId: "workspace-1" }] },
  ]);
  assert.deepEqual(invalidated, ["workspace-1"]);
});

test("resolves the current Workspace store for every call", async () => {
  const calls: string[] = [];
  const first = protocolStore({
    async rename() {
      calls.push("first");
      return { workspace };
    },
  });
  const second = protocolStore({
    async rename() {
      calls.push("second");
      return { workspace };
    },
  });
  let current = first;
  const service = createWorkspaceProtocolService(
    dependencies({ resolveWorkspaceStore: () => current }),
  );

  await service.rename({ workspaceId: "workspace-1", title: "First" });
  current = second;
  await service.rename({ workspaceId: "workspace-1", title: "Second" });

  assert.deepEqual(calls, ["first", "second"]);
});
