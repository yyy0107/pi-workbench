import type { WorkspaceFeedback } from "./feedback-types";

const FEEDBACK_START = '<pi-workbench-workspace-feedback version="1">';
const FEEDBACK_END = "</pi-workbench-workspace-feedback>";

export interface WorkspaceFeedbackContextItem {
  id: string;
  kind: WorkspaceFeedback["kind"];
  target: Record<string, unknown>;
  text: string;
}

function feedbackContext(feedback: readonly WorkspaceFeedback[]): WorkspaceFeedbackContextItem[] {
  return feedback.map(({ id, kind, target, text }) => ({ id, kind, target, text }));
}

export function appendWorkspaceFeedbackContext(
  text: string,
  feedback: readonly WorkspaceFeedback[],
): string {
  if (feedback.length === 0) return text;
  const serialized = JSON.stringify(feedbackContext(feedback));
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
