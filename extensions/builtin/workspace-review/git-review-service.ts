import type { WorkspaceFeedback } from "@/components/right-workspace";

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
}

export class MemoryGitReviewService implements GitReviewService {
  readonly #changedByRepository = new Map<string, Set<string>>();
  readonly #comments: WorkspaceFeedback[] = [];
  readonly #listeners = new Set<() => void>();
  #revision = 0;

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
    this.#comments.push(feedback);
  }

  noteChanged(repositoryId: string, path: string): void {
    const paths = this.#changedByRepository.get(repositoryId) ?? new Set<string>();
    paths.add(path);
    this.#changedByRepository.set(repositoryId, paths);
    this.publish();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getRevision(): number {
    return this.#revision;
  }

  private publish(): void {
    this.#revision += 1;
    for (const listener of this.#listeners) listener();
  }
}

export const gitReviewService = new MemoryGitReviewService();
