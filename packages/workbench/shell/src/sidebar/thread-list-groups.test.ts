import assert from "node:assert/strict";
import test from "node:test";

import type { ThreadListItem } from "@workbench/agent-runtime-client";

import { groupSidebarThreads } from "./thread-list-groups";

function state(
  threadId: string,
  workspaceId?: string,
  isPinned = false,
  isRunning = false,
): ThreadListItem {
  return {
    threadId,
    isArchived: false,
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
    threads: [
      state("pinned", "one", true),
      state("project-a", "one"),
      state("draft"),
      state("ungrouped"),
    ],
    mainThreadId: "draft",
    draftWorkspaceId: "two",
  });

  assert.deepEqual(groups.pinnedThreadIds, ["pinned"]);
  assert.deepEqual(groups.threadIdsByWorkspace.get("one"), ["project-a"]);
  assert.deepEqual(groups.threadIdsByWorkspace.get("two"), ["draft"]);
  assert.deepEqual(groups.ungroupedThreadIds, ["ungrouped"]);
});

test("reports workspaces with unpinned running conversations", () => {
  const groups = groupSidebarThreads({
    threads: [
      state("pinned", "one", true, true),
      state("draft", undefined, false, true),
      state("idle", "three"),
      state("ungrouped", undefined, false, true),
    ],
    mainThreadId: "draft",
    draftWorkspaceId: "two",
  });

  assert.deepEqual(groups.runningWorkspaceIds, new Set(["two"]));
});
