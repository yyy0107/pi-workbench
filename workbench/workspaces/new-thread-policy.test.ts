import assert from "node:assert/strict";
import test from "node:test";

import {
  preferredNewThreadWorkspaceId,
  resolveSidebarThreadWorkspaceId,
} from "./new-thread-policy";

test("new conversations prefer the active workspace and fall back to the first workspace", () => {
  assert.equal(
    preferredNewThreadWorkspaceId("workspace-b", ["workspace-a", "workspace-b"]),
    "workspace-b",
  );
  assert.equal(
    preferredNewThreadWorkspaceId("stale", ["workspace-a", "workspace-b"]),
    "workspace-a",
  );
  assert.equal(preferredNewThreadWorkspaceId(undefined, []), undefined);
});

test("sidebar threads keep their workspace while a draft is becoming persistent", () => {
  assert.equal(
    resolveSidebarThreadWorkspaceId({
      customWorkspaceId: "workspace-server",
      managedWorkspaceId: "workspace-draft",
      isMainThread: true,
      draftWorkspaceId: "workspace-ui",
    }),
    "workspace-server",
  );
  assert.equal(
    resolveSidebarThreadWorkspaceId({
      customWorkspaceId: undefined,
      managedWorkspaceId: "workspace-draft",
      isMainThread: false,
      draftWorkspaceId: undefined,
    }),
    "workspace-draft",
  );
  assert.equal(
    resolveSidebarThreadWorkspaceId({
      customWorkspaceId: undefined,
      managedWorkspaceId: undefined,
      isMainThread: true,
      draftWorkspaceId: "workspace-ui",
    }),
    "workspace-ui",
  );
  assert.equal(
    resolveSidebarThreadWorkspaceId({
      customWorkspaceId: undefined,
      managedWorkspaceId: undefined,
      isMainThread: false,
      draftWorkspaceId: "workspace-ui",
    }),
    undefined,
  );
});
