import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import type { GitReviewCapture, GitReviewSnapshot } from "@workbench/workspace-server/git";
import { getReviewSnapshots, REVIEW_ENTRY_TYPE } from "../../../src/workspace-review/index";
export * from "../../../src/workspace-review/index";
export const workspaceReviewExtension: ExtensionFactory = (pi) => {
  let capture: GitReviewCapture | undefined;
  pi.on("agent_start", async (_event, ctx) => {
    capture?.dispose();
    capture = undefined;
    try {
      capture = await getReviewSnapshots().begin(ctx.cwd);
    } catch {
      console.warn("[workbench-review] Could not capture the initial workspace snapshot.");
    }
  });
  pi.on("agent_end", async (_event, ctx) => {
    const activeCapture = capture;
    capture = undefined;
    const id = randomUUID();
    const timestamp = Date.now();
    let snapshot: GitReviewSnapshot = { id, timestamp };
    if (activeCapture) {
      try {
        snapshot = await activeCapture.complete({
          id,
          threadId: ctx.sessionManager.getSessionId(),
          timestamp,
        });
      } catch {
        console.warn("[workbench-review] Could not capture the completed workspace snapshot.");
      }
    }
    pi.appendEntry<GitReviewSnapshot>(REVIEW_ENTRY_TYPE, snapshot);
  });
  pi.on("session_shutdown", () => {
    capture?.dispose();
    capture = undefined;
  });
};

export default workspaceReviewExtension;
