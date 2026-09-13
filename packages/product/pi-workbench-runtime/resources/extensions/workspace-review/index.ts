import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import type { GitReviewSnapshot } from "@workbench/workspace-server/git";
import { getReviewSnapshots, REVIEW_ENTRY_TYPE } from "../../../src/workspace-review/index";
export * from "../../../src/workspace-review/index";
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

export default workspaceReviewExtension;
