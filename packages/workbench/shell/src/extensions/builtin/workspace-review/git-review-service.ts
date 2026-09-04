"use client";

import type { WorkspaceFeedback } from "../../../right-workspace";
import { useRightWorkspaceInstallationResource } from "../../../right-workspace/right-workspace-context";

export interface GitDiffLine {
  oldLine?: number;
  newLine?: number;
  kind: "context" | "addition" | "deletion";
  text: string;
}

export interface GitDiffFile {
  path: string;
  additions: number;
  deletions: number;
  lines: readonly GitDiffLine[];
}

export interface GitDiffRequest {
  repositoryId: string;
  scope: "unstaged" | "staged" | "commit" | "branch" | "last-turn";
  revision?: string;
}

export interface GitTarget {
  repositoryId: string;
  path?: string;
}

export interface GitDiff {
  request: GitDiffRequest;
  files: readonly GitDiffFile[];
  refreshedAt: number;
}

export interface GitReviewService {
  getDiff(request: GitDiffRequest): Promise<GitDiff>;
  stage(target: GitTarget): Promise<void>;
  unstage(target: GitTarget): Promise<void>;
  revert(target: GitTarget): Promise<void>;
  addInlineComment(feedback: WorkspaceFeedback): void;
  noteChanged(repositoryId: string, path: string): void;
  subscribe(listener: () => void): () => void;
  getRevision(): number;
  dispose(): void;
}

export class MemoryGitReviewService implements GitReviewService {
  readonly #changedByRepository = new Map<string, Set<string>>();
  readonly #comments: WorkspaceFeedback[] = [];
  readonly #listeners = new Set<() => void>();
  #revision = 0;
  #closed = false;

  async getDiff(request: GitDiffRequest): Promise<GitDiff> {
    const files = [...(this.#changedByRepository.get(request.repositoryId) ?? [])].map(
      (path): GitDiffFile => ({
        path,
        additions: 1,
        deletions: 0,
        lines: [
          {
            newLine: 1,
            kind: "addition",
            text: path,
          },
        ],
      }),
    );
    return { request, files, refreshedAt: Date.now() };
  }

  async stage(_target: GitTarget): Promise<void> {}

  async unstage(_target: GitTarget): Promise<void> {}

  async revert(_target: GitTarget): Promise<void> {}

  addInlineComment(feedback: WorkspaceFeedback): void {
    if (this.#closed) return;
    this.#comments.push(feedback);
  }

  noteChanged(repositoryId: string, path: string): void {
    if (this.#closed) return;
    const paths = this.#changedByRepository.get(repositoryId) ?? new Set<string>();
    paths.add(path);
    this.#changedByRepository.set(repositoryId, paths);
    this.publish();
  }

  subscribe(listener: () => void): () => void {
    if (this.#closed) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getRevision(): number {
    return this.#revision;
  }

  dispose(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#changedByRepository.clear();
    this.#comments.length = 0;
    this.#listeners.clear();
  }

  private publish(): void {
    if (this.#closed) return;
    this.#revision += 1;
    for (const listener of this.#listeners) listener();
  }
}

const GIT_REVIEW_SERVICE_RESOURCE = Symbol("workbench.git-review-service");

export function useGitReviewService(): GitReviewService {
  return useRightWorkspaceInstallationResource(
    GIT_REVIEW_SERVICE_RESOURCE,
    () => new MemoryGitReviewService(),
  );
}
