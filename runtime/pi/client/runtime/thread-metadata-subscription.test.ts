import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { before } from "node:test";

import type { PiSessionSummary } from "../../contracts";
import type { HostStreamPayload } from "../../stream-contracts";
import type { PiClientSession } from "./manager";

let PiSessionManager: typeof import("./manager").PiSessionManager;

function summary(id: string, overrides: Partial<PiSessionSummary> = {}): PiSessionSummary {
  return {
    id,
    cwd: `/workspace/${id}`,
    workspace: {
      id: `workspace-${id}`,
      name: `Workspace ${id}`,
      cwd: `/workspace/${id}`,
    },
    created: "2026-08-20T00:00:00.000Z",
    modified: "2026-08-20T00:00:01.000Z",
    messageCount: 1,
    firstMessage: `Thread ${id}`,
    transient: false,
    running: false,
    ...overrides,
  };
}

before(async () => {
  const moduleHooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) {
        return nextResolve(
          new URL(`../../../../${specifier.slice(2)}.ts`, import.meta.url).href,
          context,
        );
      }
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
  ({ PiSessionManager } = (await import(
    new URL("./manager.ts", import.meta.url).href
  )) as typeof import("./manager"));
  moduleHooks.deregister();
});

function hostFrame(
  manager: InstanceType<typeof PiSessionManager>,
  payload: HostStreamPayload,
): void {
  const internals = manager as unknown as {
    handleHostFrame(payload: HostStreamPayload, generation: number): void;
  };
  internals.handleHostFrame(payload, 1);
}

test("notifies only the subscribed thread whose metadata changed", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  hostFrame(manager, {
    type: "host/session-added",
    sessionId: "thread-a",
    blank: false,
    summary: summary("thread-a"),
  });
  hostFrame(manager, {
    type: "host/session-added",
    sessionId: "thread-b",
    blank: false,
    summary: summary("thread-b"),
  });

  let aNotifications = 0;
  let bNotifications = 0;
  const unsubscribeA = manager.subscribeThread("thread-a", () => {
    aNotifications += 1;
  });
  const unsubscribeB = manager.subscribeThread("thread-b", () => {
    bNotifications += 1;
  });
  t.after(unsubscribeA);
  t.after(unsubscribeB);
  const aBefore = manager.getThreadStateSnapshot("thread-a");

  hostFrame(manager, {
    type: "host/session-changed",
    sessionId: "thread-b",
    summary: summary("thread-b", { name: "Renamed B" }),
  });

  assert.equal(aNotifications, 0);
  assert.equal(bNotifications, 1);
  assert.equal(manager.getThreadStateSnapshot("thread-a"), aBefore);
  assert.equal(manager.getThreadStateSnapshot("thread-b").thread?.title, "Renamed B");
});

test("publishes draft workspace changes without retaining unsubscribed buckets", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  let notifications = 0;
  const unsubscribe = manager.subscribeThread("local-thread", () => {
    notifications += 1;
  });

  manager.setDraftWorkspace("local-thread", {
    id: "draft-workspace",
    name: "Draft Workspace",
    cwd: "/workspace/draft",
  });
  assert.equal(notifications, 1);
  assert.deepEqual(manager.getThreadStateSnapshot("local-thread").metadata.workspace, {
    id: "draft-workspace",
    name: "Draft Workspace",
    cwd: "/workspace/draft",
  });

  manager.setDraftWorkspace("local-thread", {
    id: "draft-workspace",
    name: "Draft Workspace",
    cwd: "/workspace/draft",
  });
  assert.equal(notifications, 1);

  unsubscribe();
  const internals = manager as unknown as {
    threadStateBuckets: Map<string, unknown>;
  };
  assert.equal(internals.threadStateBuckets.size, 0);
  manager.getThreadStateSnapshot("unsubscribed-thread");
  manager.getThreadRevision("unsubscribed-thread");
  assert.equal(internals.threadStateBuckets.size, 0);
  manager.subscribeThread("active-thread", () => undefined);
  assert.equal(internals.threadStateBuckets.size, 1);
  manager.dispose();
  assert.equal(internals.threadStateBuckets.size, 0);
});

test("keeps a local subscription attached after the session receives its remote identity", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  manager.setDraftWorkspace("local-thread", {
    id: "draft-workspace",
    name: "Draft Workspace",
    cwd: "/workspace/draft",
  });
  const session = manager.getSession("local-thread");
  let notifications = 0;
  const unsubscribe = manager.subscribeThread("local-thread", () => {
    notifications += 1;
  });
  t.after(unsubscribe);
  const internals = manager as unknown as {
    bindSession(
      localId: string,
      session: PiClientSession,
      summary: PiSessionSummary,
      workspaceId?: string,
    ): void;
  };

  internals.bindSession("local-thread", session, summary("remote-thread"));

  assert.equal(notifications, 1);
  assert.equal(manager.getThreadStateSnapshot("local-thread").thread?.remoteId, "remote-thread");
  assert.equal(
    manager.getThreadStateSnapshot("local-thread").metadata.createdAt,
    "2026-08-20T00:00:00.000Z",
  );
});

test("notifies a member when its canonical workspace changes", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  hostFrame(manager, {
    type: "host/session-added",
    sessionId: "thread-b",
    blank: false,
    summary: summary("thread-b"),
  });
  hostFrame(manager, {
    type: "host/workspace-changed",
    workspace: {
      workspaceId: "workspace-thread-b",
      title: "Original Workspace",
      path: "/workspace/thread-b",
      sessionIds: ["thread-b"],
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    },
  });
  let notifications = 0;
  const unsubscribe = manager.subscribeThread("thread-b", () => {
    notifications += 1;
  });
  t.after(unsubscribe);

  hostFrame(manager, {
    type: "host/workspace-changed",
    workspace: {
      workspaceId: "workspace-thread-b",
      title: "Renamed Workspace",
      path: "/workspace/thread-b",
      sessionIds: ["thread-b"],
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:01.000Z",
    },
  });

  assert.equal(notifications, 1);
  assert.equal(
    manager.getThreadStateSnapshot("thread-b").metadata.workspace?.name,
    "Renamed Workspace",
  );
});

test("replays live session changes over a stale running response", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let resolveSessionList!: (response: Response) => void;
  let sessionListRpcId: string | undefined;
  let sessionListCalls = 0;
  const sessionList = new Promise<Response>((resolve) => {
    resolveSessionList = resolve;
  });
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
    if (request.method === "session.list") {
      sessionListCalls += 1;
      if (sessionListCalls > 1) {
        return Response.json({
          type: "server-response",
          rpcId: request.rpcId,
          result: {
            ok: true,
            value: {
              items: [
                {
                  sessionId: "changed-thread",
                  updatedAt: Date.parse("2026-08-20T00:00:01.000Z"),
                  running: true,
                  blank: false,
                  cwd: "/workspace/changed-thread",
                },
              ],
            },
          },
        });
      }
      sessionListRpcId = request.rpcId;
      return sessionList;
    }
    const value =
      request.method === "workspace.list"
        ? { items: [], pinnedWorkspaceIds: [], pinnedSessionIds: [] }
        : { sessionIds: [] };
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  hostFrame(manager, {
    type: "host/session-added",
    sessionId: "removed-thread",
    blank: false,
    summary: summary("removed-thread", { running: true }),
  });
  hostFrame(manager, {
    type: "host/session-added",
    sessionId: "changed-thread",
    blank: false,
    summary: summary("changed-thread"),
  });
  const refresh = manager.refreshMetadata();
  hostFrame(manager, {
    type: "host/session-removed",
    sessionId: "removed-thread",
  });
  hostFrame(manager, {
    type: "host/session-changed",
    sessionId: "changed-thread",
    summary: summary("changed-thread", { running: true }),
  });
  assert.equal(manager.isRunning("removed-thread"), false);
  assert.equal(manager.isRunning("changed-thread"), true);

  resolveSessionList(
    Response.json({
      type: "server-response",
      rpcId: sessionListRpcId,
      result: {
        ok: true,
        value: {
          items: [
            {
              sessionId: "removed-thread",
              updatedAt: Date.parse("2026-08-20T00:00:01.000Z"),
              running: true,
              blank: false,
              cwd: "/workspace/removed-thread",
            },
            {
              sessionId: "changed-thread",
              updatedAt: Date.parse("2026-08-20T00:00:01.000Z"),
              running: false,
              blank: false,
              cwd: "/workspace/changed-thread",
            },
          ],
        },
      },
    }),
  );
  await refresh;
  await (manager as unknown as { realtimeRefreshTask?: Promise<void> }).realtimeRefreshTask;

  assert.equal(manager.isRunning("removed-thread"), false);
  assert.equal(manager.getThreadStateSnapshot("removed-thread").thread, undefined);
  assert.equal(manager.isRunning("changed-thread"), true);
  assert.equal(manager.getThreadStateSnapshot("changed-thread").metadata.running, true);
});
