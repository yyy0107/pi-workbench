import type { PromptFeedbackPort } from "@workbench/agent-runtime-client/prompt-feedback";
import type { WorkspaceFeedbackClaimPort } from "../right-workspace";

/** Explicitly adapts Shell-owned claim semantics to the installed Agent Runtime boundary. */
export function createRightWorkspacePromptFeedbackPort(
  feedback: WorkspaceFeedbackClaimPort,
): PromptFeedbackPort {
  return Object.freeze({
    claimForThreads(threadIds: readonly string[]) {
      const claim = feedback.claimForThreads(threadIds);
      if (!claim) return undefined;
      return {
        token: claim.token,
        items: claim.items.map(({ id, kind, target, text, images }) => ({
          id,
          kind,
          target: { ...target },
          text,
          ...(images ? { images: images.map((image) => ({ ...image })) } : {}),
        })),
      };
    },
    commit(token: string) {
      feedback.commit(token);
    },
    release(token: string) {
      feedback.release(token);
    },
  });
}
