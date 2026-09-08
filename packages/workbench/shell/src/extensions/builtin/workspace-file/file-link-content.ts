import { WORKSPACE_FILE_EDITABLE_SIZE_LIMIT } from "@workbench/agent-runtime-contracts/runtime-capabilities";
import type { WorkbenchLocalFilesCapability } from "@workbench/agent-runtime-client/capabilities";
import type { FileSnapshot } from "../../../workspace-files/workspace-file-service";

/** Clean cached buffers may predate an external edit; only unsaved edits take priority over disk. */
export function unsavedFileLinkContent(
  snapshot?: Pick<FileSnapshot, "content" | "savedContent">,
): string | undefined {
  return snapshot && snapshot.content !== snapshot.savedContent ? snapshot.content : undefined;
}

/** Copy the current editor buffer when available; otherwise keep the existing UTF-8 validation. */
export async function readFileLinkText(
  files: Pick<WorkbenchLocalFilesCapability, "readFile" | "streamFileText">,
  path: string,
  size: number,
  bufferContent?: string,
): Promise<string> {
  if (bufferContent !== undefined) return bufferContent;
  if (size <= WORKSPACE_FILE_EDITABLE_SIZE_LIMIT) return (await files.readFile(path)).content;
  const chunks: string[] = [];
  await files.streamFileText(path, { onChunk: (chunk) => chunks.push(chunk.text) });
  return chunks.join("");
}
