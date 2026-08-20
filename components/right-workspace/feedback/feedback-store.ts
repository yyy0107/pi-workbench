import type { WorkspaceContext } from "../core/surface-types";
import { scopeMatchesContext } from "../core/workspace-selectors";
import type { WorkspaceFeedback, WorkspaceFeedbackDraft } from "./feedback-types";

export interface WorkspaceFeedbackSnapshot {
  feedback: readonly WorkspaceFeedback[];
  revision: number;
}

export interface WorkspaceFeedbackStore {
  getSnapshot(): WorkspaceFeedbackSnapshot;
  subscribe(listener: () => void): () => void;
  add(draft: WorkspaceFeedbackDraft): string;
  update(id: string, patch: Partial<Pick<WorkspaceFeedback, "text" | "target">>): void;
  remove(id: string): void;
  clearSurface(surfaceId: string): void;
  clear(ids: readonly string[]): void;
  forContext(context: WorkspaceContext): readonly WorkspaceFeedback[];
  forThread(threadIds: readonly string[]): readonly WorkspaceFeedback[];
}

function createFeedbackId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `feedback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

export class MemoryWorkspaceFeedbackStore implements WorkspaceFeedbackStore {
  readonly #listeners = new Set<() => void>();
  #snapshot: WorkspaceFeedbackSnapshot = { feedback: [], revision: 0 };

  getSnapshot = (): WorkspaceFeedbackSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  add = (draft: WorkspaceFeedbackDraft): string => {
    const id = createFeedbackId();
    this.replace([
      ...this.#snapshot.feedback,
      { ...draft, id, target: { ...draft.target }, createdAt: Date.now() },
    ]);
    return id;
  };

  update = (id: string, patch: Partial<Pick<WorkspaceFeedback, "text" | "target">>): void => {
    this.replace(
      this.#snapshot.feedback.map((feedback) =>
        feedback.id === id
          ? {
              ...feedback,
              ...patch,
              target: patch.target ? { ...patch.target } : feedback.target,
            }
          : feedback,
      ),
    );
  };

  remove = (id: string): void => {
    this.replace(this.#snapshot.feedback.filter((feedback) => feedback.id !== id));
  };

  clearSurface = (surfaceId: string): void => {
    this.replace(this.#snapshot.feedback.filter((feedback) => feedback.surfaceId !== surfaceId));
  };

  clear = (ids: readonly string[]): void => {
    const removed = new Set(ids);
    this.replace(this.#snapshot.feedback.filter((feedback) => !removed.has(feedback.id)));
  };

  forContext = (context: WorkspaceContext): readonly WorkspaceFeedback[] => {
    return this.#snapshot.feedback.filter(
      (feedback) =>
        scopeMatchesContext(feedback.scope, context) ||
        (feedback.threadId !== undefined && feedback.threadId === context.threadId),
    );
  };

  forThread = (threadIds: readonly string[]): readonly WorkspaceFeedback[] => {
    const ids = new Set(threadIds.filter(Boolean));
    return this.#snapshot.feedback.filter(
      (feedback) => feedback.threadId !== undefined && ids.has(feedback.threadId),
    );
  };

  private replace(feedback: readonly WorkspaceFeedback[]): void {
    if (
      feedback.length === this.#snapshot.feedback.length &&
      feedback.every((item, index) => item === this.#snapshot.feedback[index])
    ) {
      return;
    }
    this.#snapshot = { feedback, revision: this.#snapshot.revision + 1 };
    for (const listener of this.#listeners) listener();
  }
}
