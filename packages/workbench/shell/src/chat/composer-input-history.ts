import type { useAgentRuntime, useConversationSession } from "@workbench/agent-runtime-client";

type Runtime = ReturnType<typeof useAgentRuntime>;
type Session = ReturnType<typeof useConversationSession>;
type HistoryCursor = { entries: string[]; index: number };

class ComposerInputHistory {
  private readonly inputs: string[] = [];
  private readonly cursors = new WeakMap<Session, HistoryCursor>();

  record(session: Session, text: string): void {
    this.cursors.delete(session);
    if (!text.trim() || this.inputs.at(-1) === text) return;
    this.inputs.push(text);
    // ponytail: retain 5 inputs in memory; add persistence if reload recovery is needed.
    if (this.inputs.length > 5) this.inputs.shift();
  }

  navigate(session: Session, direction: "previous" | "next"): boolean {
    const { composer } = session.snapshot.getSnapshot();
    const setText = session.actions.setComposerText;
    if (!setText || composer.phase === "submitting") return false;
    let cursor = this.cursors.get(session);
    if (!cursor) {
      if (direction === "next" || this.inputs.length === 0) return false;
      cursor = { entries: [...this.inputs, composer.text], index: this.inputs.length };
      this.cursors.set(session, cursor);
    }
    cursor.entries[cursor.index] = composer.text;
    const nextIndex = cursor.index + (direction === "previous" ? -1 : 1);
    if (nextIndex < 0 || nextIndex >= cursor.entries.length) return false;
    cursor.index = nextIndex;
    setText(cursor.entries[nextIndex]!);
    if (nextIndex === cursor.entries.length - 1) this.cursors.delete(session);
    return true;
  }
}

const histories = new WeakMap<Runtime, Map<string, ComposerInputHistory>>();

export function getComposerInputHistory(
  runtime: Runtime,
  session: Session,
  draftWorkspaceId?: string,
): ComposerInputHistory {
  const current = runtime.current.getSnapshot();
  const isCurrent = current.sessionId === session.id;
  const isDraft = isCurrent && current.isNewThread;
  const threadId = isCurrent ? current.threadId : session.id;
  const workspaceId = isDraft
    ? draftWorkspaceId
    : runtime.threads.getSnapshot().threads.find((thread) => thread.threadId === threadId)
        ?.workspace?.id;
  const scope = workspaceId
    ? `workspace:${workspaceId}`
    : isDraft
      ? "draft:unassigned"
      : `session:${session.id}`;
  let scoped = histories.get(runtime);
  if (!scoped) histories.set(runtime, (scoped = new Map()));
  let history = scoped.get(scope);
  if (!history) scoped.set(scope, (history = new ComposerInputHistory()));
  return history;
}
