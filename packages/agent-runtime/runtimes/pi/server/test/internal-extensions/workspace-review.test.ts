import { GitReviewSnapshots } from "@workbench/workspace-server/git";
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  workspaceReviewExtension,
  REVIEW_ENTRY_TYPE,
} from "../../src/internal-extensions/workspace-review";

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
