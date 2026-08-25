import assert from "node:assert/strict";
import test from "node:test";

import type { PiSessionSummary } from "../../contracts";
import type { WorkspaceView } from "../../rpc-contracts";

import { PiSessionManager } from "./manager";

function sessionSummary(id: string, cwd: string): PiSessionSummary {
  return {
    id,
    cwd,
    workspace: { id: `legacy:${cwd}`, name: cwd, cwd },
    created: "2026-08-24T00:00:00.000Z",
    modified: "2026-08-24T00:00:00.000Z",
    messageCount: 0,
    firstMessage: "",
    transient: false,
    running: false,
  };
}

test("accepts an authoritative create result before workspace reconciliation", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());

  manager.acceptCreatedWorkspace({
    id: "workspace-created",
    name: "Created Workspace",
    cwd: "/workspace/created",
  });

  assert.deepEqual(manager.getWorkspaces(), [
    {
      id: "workspace-created",
      name: "Created Workspace",
      cwd: "/workspace/created",
      pinned: false,
    },
  ]);
});

test("keeps an accepted create result when best-effort reconciliation fails", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    throw new Error("workspace refresh offline");
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  manager.acceptCreatedWorkspace({
    id: "workspace-created",
    name: "Created Workspace",
    cwd: "/workspace/created",
  });

  await assert.rejects(manager.refreshWorkspaceMetadata());

  assert.equal(manager.getWorkspaces()[0]?.id, "workspace-created");
});

test("provides one resource catalog target per project without following the active session", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const internals = manager as unknown as {
    summaries: Map<string, PiSessionSummary>;
    workspaces: Map<string, WorkspaceView>;
  };
  internals.workspaces.set("project-1", {
    workspaceId: "project-1",
    path: "/workspace/one",
    title: "Project One",
    sessionIds: ["session-1", "session-2"],
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  });
  internals.workspaces.set("project-2", {
    workspaceId: "project-2",
    path: "/workspace/two",
    title: "Project Two",
    sessionIds: ["session-3"],
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  });
  internals.summaries.set("session-1", sessionSummary("session-1", "/workspace/one"));
  internals.summaries.set("session-2", sessionSummary("session-2", "/workspace/one"));
  internals.summaries.set("session-3", sessionSummary("session-3", "/workspace/two"));
  internals.summaries.set("session-app", sessionSummary("session-app", "/outside"));
  manager.setActive("session-2", "session-2");

  assert.deepEqual(manager.getResourceCatalogTargets(), [
    {
      sessionId: "session-1",
      project: { id: "project-1", name: "Project One", path: "/workspace/one" },
    },
    {
      sessionId: "session-3",
      project: { id: "project-2", name: "Project Two", path: "/workspace/two" },
    },
    { sessionId: "session-app" },
  ]);
});
