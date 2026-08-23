import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceContext, WorkspaceSurfaceInstance } from "@/components/right-workspace";

import { contextExplorerSurfaces, contextHasFileSurface } from "./explorer-runtime-policy";

const context: WorkspaceContext = {
  applicationId: "app",
  threadId: "thread-1",
  worktreeId: "workspace-1",
  rootPath: "/workspace",
};

function surface(id: string, kind: string, scopeKey = "thread-1"): WorkspaceSurfaceInstance {
  return {
    id,
    kind,
    placement: kind === "explorer" ? "auxiliary" : "primary",
    title: id,
    resourceKey: id,
    scope: { type: "thread", key: scopeKey },
    params: {},
    status: "ready",
    createdAt: 1,
    lastActiveAt: 1,
  };
}

test("shows Explorer only when the current context owns a File Surface", () => {
  assert.equal(contextHasFileSurface([surface("terminal:1", "terminal")], context), false);
  assert.equal(contextHasFileSurface([surface("file:other", "file", "thread-2")], context), false);
  assert.equal(contextHasFileSurface([surface("file:1", "file")], context), true);
});

test("selects only Explorer Surfaces owned by the current context", () => {
  const current = surface("explorer:1", "explorer");
  const other = surface("explorer:other", "explorer", "thread-2");
  assert.deepEqual(contextExplorerSurfaces([current, other, surface("file:1", "file")], context), [
    current,
  ]);
});
