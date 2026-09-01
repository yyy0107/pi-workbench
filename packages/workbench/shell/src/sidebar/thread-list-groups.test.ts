import assert from "node:assert/strict";
import test from "node:test";

import type { WorkbenchAgentThreadSnapshot } from "@workbench/agent-runtime-client/adapter";

import { groupSidebarThreads } from "./thread-list-groups";

function state(
  workspaceId?: string,
  isPinned = false,
  isRunning = false,
): WorkbenchAgentThreadSnapshot {
  return {
    isRunning,
    isWaitingForInput: false,
    hasUnreadCompletion: false,
    isPinned,
    ...(workspaceId
      ? { workspace: { id: workspaceId, name: workspaceId, rootPath: `/${workspaceId}` } }
      : {}),
  };
}

test("groups each conversation once for scoped sidebar rendering", () => {
  const groups = groupSidebarThreads({
    threadIds: ["pinned", "project-a", "draft", "ungrouped"],
    states: new Map([
      ["pinned", state("one", true)],
      ["project-a", state("one")],
      ["draft", state()],
      ["ungrouped", state()],
    ]),
    mainThreadId: "draft",
    draftWorkspaceId: "two",
  });

  assert.deepEqual(groups.pinnedThreadIds, ["pinned"]);
  assert.deepEqual(groups.threadIdsByWorkspace.get("one"), ["project-a"]);
  assert.deepEqual(groups.threadIdsByWorkspace.get("two"), ["draft"]);
  assert.deepEqual(groups.ungroupedThreadIds, ["ungrouped"]);
});

test("reports workspaces with running conversations, including pinned and draft conversations", () => {
  const groups = groupSidebarThreads({
    threadIds: ["pinned", "draft", "idle", "ungrouped"],
    states: new Map([
      ["pinned", state("one", true, true)],
      ["draft", state(undefined, false, true)],
      ["idle", state("three")],
      ["ungrouped", state(undefined, false, true)],
    ]),
    mainThreadId: "draft",
    draftWorkspaceId: "two",
  });

  assert.deepEqual(groups.runningWorkspaceIds, new Set(["one", "two"]));
});
