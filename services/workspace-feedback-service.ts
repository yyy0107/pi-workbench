export interface PromptFeedbackItem {
  readonly id: string;
  readonly kind: string;
  readonly target: Readonly<Record<string, unknown>>;
  readonly text: string;
}

/** Opaque ownership token for one immutable snapshot of pending prompt feedback. */
export interface PromptFeedbackClaim {
  readonly token: string;
  readonly items: readonly PromptFeedbackItem[];
}

/**
 * Narrow application boundary used when a prompt claims pending workspace feedback.
 *
 * UI ownership, rendering state, and workspace scoping stay outside this contract. The runtime
 * only needs to atomically claim feedback for the active thread aliases, then acknowledge or
 * release that claim. Implementations must exclude claimed item versions from concurrent claims.
 * A commit must remove only the versions represented by the claim, so an edit made while the
 * prompt is in flight remains pending.
 */
export interface PromptFeedbackPort {
  claimForThreads(threadIds: readonly string[]): PromptFeedbackClaim | undefined;
  commit(token: string): void;
  release(token: string): void;
}

const FEEDBACK_START = '<pi-workbench-workspace-feedback version="1">';
const FEEDBACK_END = "</pi-workbench-workspace-feedback>";

function promptFeedbackContext(
  feedback: readonly PromptFeedbackItem[],
): readonly PromptFeedbackItem[] {
  return feedback.map(({ id, kind, target, text }) => ({ id, kind, target, text }));
}

function serializePromptFeedback(feedback: readonly PromptFeedbackItem[]): string {
  // The payload is framed by XML-like sentinels so it remains legible to the model. Escape every
  // opening angle bracket inside JSON to prevent user-authored feedback from impersonating either
  // sentinel and confusing the history projection that strips the envelope again.
  return JSON.stringify(promptFeedbackContext(feedback)).replaceAll("<", "\\u003c");
}

export function appendWorkspaceFeedbackContext(
  text: string,
  feedback: readonly PromptFeedbackItem[],
): string {
  if (feedback.length === 0) return text;
  const serialized = serializePromptFeedback(feedback);
  return `${text.trimEnd()}\n\n${FEEDBACK_START}\n${serialized}\n${FEEDBACK_END}`;
}

export function stripWorkspaceFeedbackContext(text: string): string {
  const start = text.lastIndexOf(FEEDBACK_START);
  if (start < 0) return text;
  const end = text.indexOf(FEEDBACK_END, start);
  if (end < 0) return text;
  const before = text.slice(0, start).trimEnd();
  const after = text.slice(end + FEEDBACK_END.length).trimStart();
  return [before, after].filter(Boolean).join("\n\n");
}
