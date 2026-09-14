/** Stable persisted entry ID retained from the original workspace-review snapshots. */
export const WORKBENCH_FILE_CHANGE_SET_CUSTOM_TYPE = "workbench.workspace-review.v1";
export const WORKBENCH_FILE_CHANGE_SET_PRESENTATION_KEY = "workbenchFileChangeSet";

export type WorkbenchFileChangeKind = "added" | "modified" | "deleted" | "renamed" | "copied";

export interface WorkbenchFileChange {
  readonly path: string;
  readonly previousPath?: string;
  readonly kind: WorkbenchFileChangeKind;
  readonly additions?: number;
  readonly deletions?: number;
  readonly binary?: boolean;
}

/** Runtime-neutral, message-safe projection of one task run's workspace changes. */
export interface WorkbenchFileChangeSet {
  readonly version: 1;
  readonly id: string;
  readonly threadId: string;
  readonly createdAt: number;
  readonly files: readonly WorkbenchFileChange[];
  readonly totalFiles: number;
  readonly additions: number;
  readonly deletions: number;
  readonly truncated?: boolean;
  readonly undoAvailable: boolean;
}

export interface WorkbenchFileChangeMutationRequest {
  readonly workspaceId: string;
  readonly threadId: string;
  readonly changeSetId: string;
}

export interface WorkbenchFileChangeMutationResult {
  readonly applied: true;
  readonly direction: "undo" | "redo";
  readonly merged: boolean;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function finiteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isWorkspaceRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 4096 || value.includes("\0")) {
    return false;
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[a-z]:\//iu.test(normalized)) return false;
  return !normalized
    .split("/")
    .some((segment) => segment === "" || segment === "." || segment === "..");
}

function parseFileChange(value: unknown): WorkbenchFileChange | undefined {
  const candidate = asRecord(value);
  if (!candidate || !isWorkspaceRelativePath(candidate.path)) return undefined;
  if (
    candidate.kind !== "added" &&
    candidate.kind !== "modified" &&
    candidate.kind !== "deleted" &&
    candidate.kind !== "renamed" &&
    candidate.kind !== "copied"
  ) {
    return undefined;
  }
  if (
    (candidate.previousPath !== undefined ||
      candidate.kind === "renamed" ||
      candidate.kind === "copied") &&
    !isWorkspaceRelativePath(candidate.previousPath)
  ) {
    return undefined;
  }
  if (candidate.additions !== undefined && !finiteNonNegativeInteger(candidate.additions)) {
    return undefined;
  }
  if (candidate.deletions !== undefined && !finiteNonNegativeInteger(candidate.deletions)) {
    return undefined;
  }
  if (candidate.binary !== undefined && typeof candidate.binary !== "boolean") return undefined;
  return {
    path: candidate.path,
    kind: candidate.kind,
    ...(candidate.previousPath === undefined ? {} : { previousPath: candidate.previousPath }),
    ...(candidate.additions === undefined ? {} : { additions: candidate.additions }),
    ...(candidate.deletions === undefined ? {} : { deletions: candidate.deletions }),
    ...(candidate.binary === undefined ? {} : { binary: candidate.binary }),
  };
}

export function parseWorkbenchFileChangeSet(value: unknown): WorkbenchFileChangeSet | undefined {
  const candidate = asRecord(value);
  if (
    candidate?.version !== 1 ||
    typeof candidate.id !== "string" ||
    !candidate.id ||
    candidate.id.length > 4096 ||
    typeof candidate.threadId !== "string" ||
    !candidate.threadId ||
    candidate.threadId.length > 4096 ||
    typeof candidate.createdAt !== "number" ||
    !Number.isFinite(candidate.createdAt) ||
    !Array.isArray(candidate.files) ||
    candidate.files.length > 200 ||
    !finiteNonNegativeInteger(candidate.totalFiles) ||
    !finiteNonNegativeInteger(candidate.additions) ||
    !finiteNonNegativeInteger(candidate.deletions) ||
    typeof candidate.undoAvailable !== "boolean" ||
    (candidate.truncated !== undefined && typeof candidate.truncated !== "boolean")
  ) {
    return undefined;
  }
  const files = candidate.files.map(parseFileChange);
  if (files.some((file) => file === undefined) || candidate.totalFiles < files.length) {
    return undefined;
  }
  return {
    version: 1,
    id: candidate.id,
    threadId: candidate.threadId,
    createdAt: candidate.createdAt,
    files: files as WorkbenchFileChange[],
    totalFiles: candidate.totalFiles,
    additions: candidate.additions,
    deletions: candidate.deletions,
    undoAvailable: candidate.undoAvailable,
    ...(candidate.truncated === undefined ? {} : { truncated: candidate.truncated }),
  };
}
