import { GitReviewSnapshots } from "@workbench/workspace-server/git";
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  workspaceReviewExtension,
  REVIEW_ENTRY_TYPE,
} from "@workbench/pi-workbench-runtime/extensions/workspace-review";

test("records each completed Agent run and never reuses a failed baseline", async (t) => {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
  const entries: { type: string; data: unknown }[] = [];
  await workspaceReviewExtension({
    on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) =>
      handlers.set(name, handler),
    appendEntry: (type: string, data: unknown) => entries.push({ type, data }),
  } as unknown as ExtensionAPI);
  const ctx = { cwd: "/workspace" } as ExtensionContext;
  const before = "a".repeat(40),
    after = "b".repeat(40);
  let capture = 0;
  t.mock.method(GitReviewSnapshots.prototype, "capture", async () =>
    ++capture === 1 ? before : after,
  );
  await handlers.get("agent_start")!({}, ctx);
  await handlers.get("agent_end")!({}, ctx);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, REVIEW_ENTRY_TYPE);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(entries[0].data as object).filter(
        ([key]) => key === "before" || key === "after",
      ),
    ),
    { before, after },
  );
  t.mock.method(GitReviewSnapshots.prototype, "capture", async () => {
    throw new Error("disk unavailable");
  });
  t.mock.method(console, "warn", () => {});
  await handlers.get("agent_start")!({}, ctx);
  await handlers.get("agent_end")!({}, ctx);
  assert.equal(entries.length, 2);
  assert.equal((entries[1].data as { before?: string }).before, undefined);
});

test("product review parsing preserves valid snapshots and rejects malformed persisted entries", async (t) => {
  const { resolveWorkbenchReviewSnapshots } =
    await import("@workbench/pi-workbench-runtime/extensions/workspace-review");
  t.mock.method(GitReviewSnapshots.prototype, "directory", async () => "/review/project");
  const valid = { id: "review-1", timestamp: 42, before: "a".repeat(40), after: "b".repeat(64) };
  const entries = [
    { type: "custom", customType: REVIEW_ENTRY_TYPE, data: valid },
    { type: "custom", customType: "another-extension", data: valid },
    { type: "custom", customType: REVIEW_ENTRY_TYPE, data: { ...valid, after: "invalid" } },
    { type: "custom", customType: REVIEW_ENTRY_TYPE, data: { ...valid, timestamp: Number.NaN } },
  ];
  const result = await resolveWorkbenchReviewSnapshots("/project", {
    getCwd: () => "/project",
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
      getBranch: () => [],
    }),
    { code: "pi_session_not_found", status: 404 },
  );
});
