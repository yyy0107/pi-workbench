"use client";

import { useRightWorkspaceInstallationResource } from "../../../right-workspace/right-workspace-context";

/** Invalidates review data; the workspace capability owns all Git reads. */
export class GitReviewChanges {
  readonly #revisions = new Map<string, number>();
  readonly #listeners = new Set<() => void>();
  #closed = false;

  noteChanged(repositoryId: string): void {
    if (this.#closed) return;
    this.#revisions.set(repositoryId, this.getRevision(repositoryId) + 1);
    for (const listener of this.#listeners) listener();
  }

  getRevision = (repositoryId: string): number => this.#revisions.get(repositoryId) ?? 0;
  subscribe = (listener: () => void): (() => void) => {
    if (this.#closed) return () => undefined;
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  dispose(): void {
    this.#closed = true;
    this.#revisions.clear();
    this.#listeners.clear();
  }
}

const GIT_REVIEW_SERVICE_RESOURCE = Symbol("workbench.git-review-service");

export function useGitReviewService(): GitReviewChanges {
  return useRightWorkspaceInstallationResource(
    GIT_REVIEW_SERVICE_RESOURCE,
    () => new GitReviewChanges(),
  );
}
