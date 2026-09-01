import assert from "node:assert/strict";
import test from "node:test";

import { syncConversationWorkspaceSelection } from "./application";

test("pinned conversations preserve the current workspace selection", () => {
  const revealedWorkspaceIds: string[] = [];
  const revealWorkspace = (workspaceId: string) => revealedWorkspaceIds.push(workspaceId);

  syncConversationWorkspaceSelection("pinned-workspace", true, revealWorkspace);
  syncConversationWorkspaceSelection("regular-workspace", false, revealWorkspace);

  assert.deepEqual(revealedWorkspaceIds, ["regular-workspace"]);
});
