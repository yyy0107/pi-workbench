import {
  fileWorkspaceService as files,
  type WorkspaceFileContext,
} from "@/services/workspace-file-service";

import { clearFileBufferDraft, type FileBufferDraftStorage } from "./file-buffer-draft";

export async function saveFileBuffer({
  context,
  path,
  storage,
  surfaceId,
}: {
  context: WorkspaceFileContext;
  path: string;
  storage: FileBufferDraftStorage | undefined;
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
