import type { useAgentRuntime } from "@workbench/agent-runtime-client";

/** Use only the existing draft API; never submit or silently dispose an unsent draft. */
export function insertPromptDraft(
  runtime: ReturnType<typeof useAgentRuntime>,
  destination: string,
  content: string,
  workspaceId?: string,
): void {
  const current = runtime.current.getSnapshot();
  const active = current.sessionId ? runtime.session(current.sessionId) : undefined;
  const draft = active?.snapshot.getSnapshot().composer;
  const selectingCurrentDraft = destination === `draft:${current.sessionId}`;
  if (
    current.isNewThread &&
    !selectingCurrentDraft &&
    (draft?.text.trim() || draft?.attachments.length)
  ) {
    throw new Error("prompt-existing-draft");
  }
  if (destination.startsWith("draft:") && !selectingCurrentDraft)
    throw new Error("prompt-destination-changed");
  let sessionId = current.sessionId;
  if (destination === "new") sessionId = runtime.createDraft({ workspaceId });
  else if (!selectingCurrentDraft) {
    runtime.switchToThread(destination);
    sessionId = runtime.current.getSnapshot().sessionId;
  }
  const session = sessionId ? runtime.session(sessionId) : undefined;
  const composer = session?.snapshot.getSnapshot().composer;
  if (!session?.actions.setComposerText || !composer || composer.phase === "submitting") {
    throw new Error("prompt-composer-unavailable");
  }
  session.actions.setComposerText(
    composer.text.trim() ? `${composer.text}\n\n${content}` : content,
  );
}
