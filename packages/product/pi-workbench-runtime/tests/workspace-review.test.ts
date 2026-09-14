import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  REVIEW_ENTRY_TYPE,
  workspaceReviewExtension,
} from "@workbench/pi-workbench-runtime/extensions/workspace-review";
import { GitReviewSnapshots, type GitReviewCapture } from "@workbench/workspace-server/git";

test("records each completed Agent run from workspace snapshots and never reuses a failed baseline", async (t) => {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const entries: { type: string; data: unknown }[] = [];
  await workspaceReviewExtension({
    on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) =>
      handlers.set(name, handler),
    appendEntry: (type: string, data: unknown) => entries.push({ type, data }),
  } as unknown as ExtensionAPI);
  const ctx = {
    cwd: "/workspace",
    sessionManager: { getSessionId: () => "thread-1" },
  } as ExtensionContext;
  const before = "a".repeat(40);
  const after = "b".repeat(40);
  let beginCount = 0;
  let disposed = false;
  const capture: GitReviewCapture = {
    before,
    observedPaths: () => [],
    subscribe: () => () => {},
    dispose: () => {
      disposed = true;
    },
    complete: async ({ id = "missing", threadId, timestamp = 0 }) => ({
      id,
      timestamp,
      before,
      after,
      changeSet: {
        version: 1,
        id,
        threadId,
        createdAt: timestamp,
        files: [{ path: "src/example.ts", kind: "modified", additions: 1, deletions: 1 }],
        totalFiles: 1,
        additions: 1,
        deletions: 1,
        undoAvailable: true,
      },
    }),
  };
  t.mock.method(GitReviewSnapshots.prototype, "begin", async () => {
    if (++beginCount === 1) return capture;
    throw new Error("disk unavailable");
  });
  t.mock.method(console, "warn", () => {});

  await handlers.get("agent_start")!({}, ctx);
  await handlers.get("agent_end")!({}, ctx);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.type, REVIEW_ENTRY_TYPE);
  const first = entries[0]?.data as {
    before?: string;
    after?: string;
    changeSet?: { threadId: string };
  };
  assert.equal(first.before, before);
  assert.equal(first.after, after);
  assert.equal(first.changeSet?.threadId, "thread-1");

  await handlers.get("agent_start")!({}, ctx);
  await handlers.get("agent_end")!({}, ctx);
  assert.equal(entries.length, 2);
  assert.equal((entries[1]!.data as { before?: string }).before, undefined);
  await handlers.get("session_shutdown")!({}, ctx);
  assert.equal(disposed, false, "completed captures are not disposed a second time");
});

test("product review parsing preserves valid snapshots and rejects malformed persisted entries", async (t) => {
  const { resolveWorkbenchReviewSnapshots } =
    await import("@workbench/pi-workbench-runtime/extensions/workspace-review");
  t.mock.method(GitReviewSnapshots.prototype, "directory", async () => "/review/project");
  const changeSet = {
    version: 1 as const,
    id: "review-1",
    threadId: "thread-1",
    createdAt: 42,
    files: [{ path: "src/example.ts", kind: "modified" as const, additions: 1, deletions: 1 }],
    totalFiles: 1,
    additions: 1,
    deletions: 1,
    undoAvailable: true,
  };
  const valid = {
    id: "review-1",
    timestamp: 42,
    before: "a".repeat(40),
    after: "b".repeat(64),
    changeSet,
  };
  const entries = [
    { type: "custom", customType: REVIEW_ENTRY_TYPE, data: valid },
    { type: "custom", customType: "another-extension", data: valid },
    { type: "custom", customType: REVIEW_ENTRY_TYPE, data: { ...valid, after: "invalid" } },
    { type: "custom", customType: REVIEW_ENTRY_TYPE, data: { ...valid, timestamp: Number.NaN } },
    {
      type: "custom",
      customType: REVIEW_ENTRY_TYPE,
      data: { ...valid, changeSet: { ...changeSet, id: "another-review" } },
    },
  ];
  const result = await resolveWorkbenchReviewSnapshots("/project", {
    getCwd: () => "/project",
    getSessionId: () => "thread-1",
    getBranch: () =>
      entries as ReturnType<import("@earendil-works/pi-coding-agent").SessionManager["getBranch"]>,
  });
  assert.deepEqual(result, { gitDir: "/review/project/objects.git", snapshots: [valid] });
});

test("product review parsing rejects a session belonging to another workspace", async (t) => {
  const { resolveWorkbenchReviewSnapshots } =
    await import("@workbench/pi-workbench-runtime/extensions/workspace-review");
  t.mock.method(GitReviewSnapshots.prototype, "directory", async (cwd: string) => cwd);
  await assert.rejects(
    resolveWorkbenchReviewSnapshots("/requested", {
      getCwd: () => "/different",
      getSessionId: () => "thread-1",
      getBranch: () => [],
    }),
    { code: "pi_session_not_found", status: 404 },
  );
});
