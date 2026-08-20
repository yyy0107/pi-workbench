import assert from "node:assert/strict";
import test from "node:test";

import { scopeMatchesContext } from "@/components/right-workspace/core/workspace-selectors";

import { activeWorkspaceContext } from "./active-workspace-context";

test("keeps right-workspace thread scopes exclusive when conversations share a project", () => {
  const first = activeWorkspaceContext({
    threadId: "thread-1",
    workspaceId: "project-1",
    rootPath: "/workspace",
  });
  const second = activeWorkspaceContext({
    threadId: "thread-2",
    workspaceId: "project-1",
    rootPath: "/workspace",
  });

  assert.equal(scopeMatchesContext({ type: "thread", key: "thread-1" }, first), true);
  assert.equal(scopeMatchesContext({ type: "thread", key: "thread-1" }, second), false);
  assert.equal(first.projectId, second.projectId);
});
