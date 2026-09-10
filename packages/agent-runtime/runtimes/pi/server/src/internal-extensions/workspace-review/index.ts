import path from "node:path";
import { randomUUID } from "node:crypto";
import { getAgentDir, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { GitReviewSnapshots, type GitReviewSnapshot } from "@workbench/workspace-server/git";

export const REVIEW_ENTRY_TYPE = "workbench.workspace-review.v1";
export function getReviewSnapshots() {
  return new GitReviewSnapshots(path.join(getAgentDir(), "workbench-review", "v1"));
}

export const workspaceReviewExtension: ExtensionFactory = (pi) => {
  let before: string | undefined;
  pi.on("agent_start", async (_event, ctx) => {
    before = undefined;
    try {
      before = await getReviewSnapshots().capture(ctx.cwd);
    } catch {
      console.warn("[workbench-review] Could not capture the initial workspace snapshot.");
    }
  });
  pi.on("agent_end", async (_event, ctx) => {
    const start = before;
    before = undefined;
    let after: string | undefined;
    if (start) {
      try {
        after = await getReviewSnapshots().capture(ctx.cwd);
      } catch {
        console.warn("[workbench-review] Could not capture the completed workspace snapshot.");
      }
    }
    pi.appendEntry<GitReviewSnapshot>(REVIEW_ENTRY_TYPE, {
      id: randomUUID(),
      timestamp: Date.now(),
      before: start,
      after,
    });
  });
};
