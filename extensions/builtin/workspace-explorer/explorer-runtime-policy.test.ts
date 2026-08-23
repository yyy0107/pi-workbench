import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceContext, WorkspaceSurfaceInstance } from "@/components/right-workspace";

import { contextExplorerSurfaces, isFileSurfaceActive } from "./explorer-runtime-policy";

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

test("shows Explorer only while a File Surface is active", () => {
  assert.equal(isFileSurfaceActive(surface("file:1", "file")), true);
  assert.equal(isFileSurfaceActive(surface("terminal:1", "terminal")), false);
  assert.equal(isFileSurfaceActive(surface("browser:1", "browser")), false);
  assert.equal(isFileSurfaceActive(undefined), false);
});

test("selects only Explorer Surfaces owned by the current context", () => {
  const current = surface("explorer:1", "explorer");
  const other = surface("explorer:other", "explorer", "thread-2");
  assert.deepEqual(contextExplorerSurfaces([current, other, surface("file:1", "file")], context), [
    current,
  ]);
});
