import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types runner loads the TypeScript source file directly.
import { resolveSessionCreateIntent } from "../../src/sessions/session-create-intent.ts";

test("reuses a requested session id only within the same workspace", () => {
  let next = 0;
  const createId = () => `session-${++next}`;
  const first = resolveSessionCreateIntent(undefined, "workspace-a", createId);
  const retry = resolveSessionCreateIntent(first, "workspace-a", createId);
  const moved = resolveSessionCreateIntent(retry, "workspace-b", createId);

  assert.strictEqual(retry, first);
  assert.deepEqual(first, { workspaceId: "workspace-a", sessionId: "session-1" });
  assert.deepEqual(moved, { workspaceId: "workspace-b", sessionId: "session-2" });
});
