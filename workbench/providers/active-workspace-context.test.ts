import assert from "node:assert/strict";
import test from "node:test";

import { scopeMatchesContext } from "@/components/right-workspace/core/workspace-selectors";

import {
  activeWorkspaceContext,
  mainViewWorkspaceContext,
  shouldPromoteThreadSurfaceScope,
} from "./active-workspace-context";

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

test("gives each Main View kind a stable right-workspace context isolated from conversations", () => {
  const toolbox = mainViewWorkspaceContext("toolbox");
  const toolboxAgain = mainViewWorkspaceContext("toolbox");
  const settings = mainViewWorkspaceContext("settings");
  const conversation = activeWorkspaceContext({ threadId: "thread-1" });

  assert.deepEqual(toolbox, toolboxAgain);
  assert.equal(scopeMatchesContext({ type: "thread", key: toolbox.threadId ?? "" }, toolbox), true);
  assert.equal(
    scopeMatchesContext({ type: "thread", key: toolbox.threadId ?? "" }, conversation),
    false,
  );
  assert.equal(
    scopeMatchesContext({ type: "thread", key: toolbox.threadId ?? "" }, settings),
    false,
  );
  assert.equal(scopeMatchesContext({ type: "application", key: "pi-workbench" }, toolbox), true);
  assert.equal(toolbox.projectId, undefined);
  assert.equal(toolbox.rootPath, undefined);
});

test("promotes only the matching provisional thread scope", () => {
  assert.equal(
    shouldPromoteThreadSurfaceScope({ type: "thread", key: "draft-thread" }, "draft-thread"),
    true,
  );
  assert.equal(
    shouldPromoteThreadSurfaceScope({ type: "thread", key: "other-thread" }, "draft-thread"),
    false,
  );
  assert.equal(
    shouldPromoteThreadSurfaceScope({ type: "application", key: "pi-workbench" }, "draft-thread"),
    false,
  );
  assert.equal(
    shouldPromoteThreadSurfaceScope({ type: "project", key: "project-1" }, "draft-thread"),
    false,
  );
  assert.equal(
    shouldPromoteThreadSurfaceScope({ type: "worktree", key: "worktree-1" }, "draft-thread"),
    false,
  );
  assert.equal(
    shouldPromoteThreadSurfaceScope({ type: "thread", key: "draft-thread" }, undefined),
    false,
  );
});
