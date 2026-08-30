import type {
  PromptFeedbackClaim,
  PromptFeedbackPort,
} from "@workbench/agent-runtime-client/prompt-feedback";

import type { WorkspaceContext } from "../core/surface-types";
import { scopeMatchesContext } from "../core/workspace-selectors";
import type { WorkspaceFeedback, WorkspaceFeedbackDraft } from "./feedback-types";

export interface WorkspaceFeedbackSnapshot {
  feedback: readonly WorkspaceFeedback[];
  revision: number;
}

export interface WorkspaceFeedbackStore extends PromptFeedbackPort {
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

function createFeedbackClaimToken(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `feedback-claim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

export class MemoryWorkspaceFeedbackStore implements WorkspaceFeedbackStore {
  readonly #listeners = new Set<() => void>();
  readonly #claims = new Map<string, readonly WorkspaceFeedback[]>();
  readonly #claimByFeedbackId = new Map<string, string>();
  #claimSequence = 0;
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

  claimForThreads = (threadIds: readonly string[]): PromptFeedbackClaim | undefined => {
    const feedback = this.forThread(threadIds).filter(
      (item) => !this.#claimByFeedbackId.has(item.id),
    );
    if (feedback.length === 0) return undefined;

    const token = `${createFeedbackClaimToken()}-${++this.#claimSequence}`;
    this.#claims.set(token, feedback);
    for (const item of feedback) this.#claimByFeedbackId.set(item.id, token);

    return {
      token,
      items: feedback.map(({ id, kind, target, text }) => ({
        id,
        kind,
        target: { ...target },
        text,
      })),
    };
  };

  commit = (token: string): void => {
    const claimed = this.takeClaim(token);
    if (!claimed) return;

    // Store updates replace an item object. Identity is therefore an item-level CAS: only the
    // exact version sent to Pi is removed, while an edit made during the RPC remains pending.
    const claimedVersionById = new Map(claimed.map((item) => [item.id, item]));
    this.replace(
      this.#snapshot.feedback.filter((item) => claimedVersionById.get(item.id) !== item),
    );
  };

  release = (token: string): void => {
    this.takeClaim(token);
  };

  private takeClaim(token: string): readonly WorkspaceFeedback[] | undefined {
    const claimed = this.#claims.get(token);
    if (!claimed) return undefined;
    this.#claims.delete(token);
    for (const item of claimed) {
      if (this.#claimByFeedbackId.get(item.id) === token) {
        this.#claimByFeedbackId.delete(item.id);
      }
    }
    return claimed;
  }

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
