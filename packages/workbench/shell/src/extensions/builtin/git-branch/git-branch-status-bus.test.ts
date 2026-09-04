import assert from "node:assert/strict";
import test from "node:test";

import type { WorkbenchWorkspaceGitStatus } from "@workbench/agent-runtime-contracts/runtime-capabilities";

import { publishGitBranchStatus, subscribeGitBranchStatus } from "./git-branch-status-bus";

const status = { repository: false } satisfies WorkbenchWorkspaceGitStatus;

test("partitions same workspace ids by Pi workspace-client installation", () => {
  const firstClient = {};
  const secondClient = {};
  const firstEvents: string[] = [];
  const secondEvents: string[] = [];
  const unsubscribeFirst = subscribeGitBranchStatus(firstClient, (workspaceId) =>
    firstEvents.push(workspaceId),
  );
  const unsubscribeSecond = subscribeGitBranchStatus(secondClient, (workspaceId) =>
    secondEvents.push(workspaceId),
  );

  try {
    publishGitBranchStatus(firstClient, "workspace-1", status);
    assert.deepEqual(firstEvents, ["workspace-1"]);
    assert.deepEqual(secondEvents, []);

    publishGitBranchStatus(secondClient, "workspace-1", status);
    assert.deepEqual(firstEvents, ["workspace-1"]);
    assert.deepEqual(secondEvents, ["workspace-1"]);
  } finally {
    unsubscribeSecond();
    unsubscribeFirst();
  }
});

test("unsubscribe is local to its installation and idempotent", () => {
  const client = {};
  const events: string[] = [];
  const unsubscribe = subscribeGitBranchStatus(client, (workspaceId) => events.push(workspaceId));

  unsubscribe();
  unsubscribe();
  publishGitBranchStatus(client, "workspace-1", status);

  assert.deepEqual(events, []);
});
