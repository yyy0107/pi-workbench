import type {
  WorkbenchFileChangeMutationRequest,
  WorkbenchFileChangeMutationResult,
} from "@workbench/agent-runtime-contracts/file-changes";
import { RpcDomainError } from "@workbench/api/errors";

import {
  GitReviewSnapshotConflictError,
  GitReviewSnapshotIsolationError,
  restoreGitReviewSnapshot,
  type GitReviewSnapshot,
} from "./git-review-snapshots";

export interface WorkspaceFileChangeProtocol {
  undo(
    input: WorkbenchFileChangeMutationRequest,
    signal: AbortSignal,
  ): Promise<WorkbenchFileChangeMutationResult>;
  redo(
    input: WorkbenchFileChangeMutationRequest,
    signal: AbortSignal,
  ): Promise<WorkbenchFileChangeMutationResult>;
}

export interface WorkspaceFileChangeServiceDependencies {
  readonly resolveWorkspaceRoot: (workspaceId: string) => Promise<string | undefined>;
  readonly mutateWorkspace: <Value>(
    rootPath: string,
    operation: () => Promise<{ readonly value: Value; readonly changed: boolean }>,
  ) => Promise<Value>;
  readonly resolveSnapshots: (
    cwd: string,
    threadId: string,
  ) => Promise<{ readonly gitDir: string; readonly snapshots: readonly GitReviewSnapshot[] }>;
}

type WorkspaceFileChangeErrorDetails = {
  "workspace-not-found": { readonly workspaceId: string };
  "file-change-set-not-found": { readonly changeSetId: string };
  "file-change-conflict": { readonly changeSetId: string };
  "file-change-busy": { readonly changeSetId: string };
  "file-change-failed": { readonly changeSetId: string };
};

export class WorkspaceFileChangeError<
  Code extends keyof WorkspaceFileChangeErrorDetails = keyof WorkspaceFileChangeErrorDetails,
> extends RpcDomainError<Code, WorkspaceFileChangeErrorDetails[Code]> {
  readonly code: Code;
  readonly details: WorkspaceFileChangeErrorDetails[Code];

  constructor(
    code: Code,
    message: string,
    details: WorkspaceFileChangeErrorDetails[Code],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkspaceFileChangeError";
    this.code = code;
    this.details = details;
  }
}

export function createWorkspaceFileChangeService({
  resolveWorkspaceRoot,
  mutateWorkspace,
  resolveSnapshots,
}: WorkspaceFileChangeServiceDependencies): WorkspaceFileChangeProtocol {
  const apply = async (
    direction: "undo" | "redo",
    input: WorkbenchFileChangeMutationRequest,
    signal: AbortSignal,
  ): Promise<WorkbenchFileChangeMutationResult> => {
    signal.throwIfAborted();
    const rootPath = await resolveWorkspaceRoot(input.workspaceId);
    if (!rootPath) {
      throw new WorkspaceFileChangeError("workspace-not-found", "The workspace no longer exists.", {
        workspaceId: input.workspaceId,
      });
    }
    const resolved = await resolveSnapshots(rootPath, input.threadId);
    const snapshot = resolved.snapshots.find((candidate) => candidate.id === input.changeSetId);
    if (
      !snapshot?.before ||
      !snapshot.after ||
      !snapshot.changeSet?.undoAvailable ||
      snapshot.changeSet.id !== input.changeSetId ||
      snapshot.changeSet.threadId !== input.threadId
    ) {
      throw new WorkspaceFileChangeError(
        "file-change-set-not-found",
        "This workspace change set is not available.",
        { changeSetId: input.changeSetId },
      );
    }
    const { before, after } = snapshot;
    signal.throwIfAborted();
    try {
      return await mutateWorkspace(rootPath, async () => {
        signal.throwIfAborted();
        const restored = await restoreGitReviewSnapshot(rootPath, resolved.gitDir, {
          expected: direction === "undo" ? after : before,
          target: direction === "undo" ? before : after,
        });
        return {
          value: { applied: true, direction, merged: restored.merged },
          changed: true,
        };
      });
    } catch (error) {
      if (error instanceof WorkspaceFileChangeError) throw error;
      if (error instanceof GitReviewSnapshotIsolationError) {
        throw new WorkspaceFileChangeError(
          "file-change-busy",
          "Another task is still changing this workspace.",
          { changeSetId: input.changeSetId },
          { cause: error },
        );
      }
      if (error instanceof GitReviewSnapshotConflictError) {
        throw new WorkspaceFileChangeError(
          "file-change-conflict",
          "The workspace changes overlap with newer work and were not applied.",
          { changeSetId: input.changeSetId },
          { cause: error },
        );
      }
      throw new WorkspaceFileChangeError(
        "file-change-failed",
        `The workspace changes could not be ${direction === "undo" ? "undone" : "redone"}.`,
        { changeSetId: input.changeSetId },
        { cause: error },
      );
    }
  };

  return {
    undo: (input, signal) => apply("undo", input, signal),
    redo: (input, signal) => apply("redo", input, signal),
  };
}
