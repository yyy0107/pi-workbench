import type { WorkspaceDraftStore } from "@workbench/shell/right-workspace";

export interface FileBufferDraft {
  version: string;
  savedContent: string;
  content: string;
}

const FILE_BUFFER_DRAFT_PREFIX = "workbench:workspace-file-draft:v1:";

function draftKey(surfaceId: string): string {
  return `${FILE_BUFFER_DRAFT_PREFIX}${surfaceId}`;
}

function isFileBufferDraft(value: unknown): value is FileBufferDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<FileBufferDraft>;
  return (
    typeof candidate.version === "string" &&
    typeof candidate.savedContent === "string" &&
    typeof candidate.content === "string"
  );
}

export function readFileBufferDraft(
  storage: WorkspaceDraftStore,
  surfaceId: string,
): FileBufferDraft | undefined {
  try {
    const serialized = storage.getItem(draftKey(surfaceId));
    if (!serialized) return undefined;
    const value: unknown = JSON.parse(serialized);
    return isFileBufferDraft(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeFileBufferDraft(
  storage: WorkspaceDraftStore,
  surfaceId: string,
  draft: FileBufferDraft,
): void {
  try {
    storage.setItem(draftKey(surfaceId), JSON.stringify(draft));
  } catch {
    // Draft persistence is best effort when browser storage is unavailable.
  }
}

export function clearFileBufferDraft(storage: WorkspaceDraftStore, surfaceId: string): void {
  try {
    storage.removeItem(draftKey(surfaceId));
  } catch {
    // Draft persistence is best effort when browser storage is unavailable.
  }
}
