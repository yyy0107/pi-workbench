import assert from "node:assert/strict";
import test from "node:test";

import { resolvePiCommandListPayload } from "./command-context";

test("resolves Composer commands from the active session when one exists", () => {
  assert.deepEqual(resolvePiCommandListPayload("session-1", "workspace-1"), {
    sessionId: "session-1",
  });
});

test("resolves draft Composer commands from the selected resource scope", () => {
  assert.deepEqual(resolvePiCommandListPayload(undefined, "workspace-1"), {
    target: { scope: "project", workspaceId: "workspace-1" },
  });
  assert.deepEqual(resolvePiCommandListPayload(undefined, undefined), {
    target: { scope: "user" },
  });
});
