import type { WorkspaceDraftStore } from "@workbench/workspace-runtime";

import { type FileWorkspaceService, type WorkspaceFileContext } from "@workbench/workspace-files";

import { clearFileBufferDraft } from "../lib/file-buffer-draft";

export async function saveFileBuffer({
  files,
  context,
  path,
  storage,
  surfaceId,
}: {
  files: FileWorkspaceService;
  context: WorkspaceFileContext;
  path: string;
  storage: WorkspaceDraftStore;
  surfaceId: string;
}): Promise<boolean> {
  const snapshot = files.getSnapshot(context, path);
  if (!snapshot) return false;
  if (snapshot.content === snapshot.savedContent) {
    clearFileBufferDraft(storage, surfaceId);
    return true;
  }

  await files.writeFile(context, path, snapshot.content, snapshot.version);
  clearFileBufferDraft(storage, surfaceId);
  return true;
}
