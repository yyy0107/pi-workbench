import assert from "node:assert/strict";
import test from "node:test";
import { preferredNewThreadWorkspaceId } from "../lib/new-thread-workspace-policy";
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
