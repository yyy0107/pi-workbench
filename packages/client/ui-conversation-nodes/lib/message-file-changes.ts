import {
  parseWorkbenchFileChangeSet,
  WORKBENCH_FILE_CHANGE_SET_PRESENTATION_KEY,
  type WorkbenchFileChange,
  type WorkbenchFileChangeSet,
} from "@workbench/agent-runtime-contracts/file-changes";
import type { MessageRendererNode } from "@workbench/extension-sdk";

export interface MessageFileChange extends WorkbenchFileChange {
  readonly filename: string;
  readonly directory: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface MessageFileChanges extends Omit<WorkbenchFileChangeSet, "files"> {
  readonly files: readonly MessageFileChange[];
}

export function splitMessageFileChangePath(filePath: string): {
  filename: string;
  directory: string;
} {
  const normalized = filePath.replaceAll("\\", "/");
  const separator = normalized.lastIndexOf("/");
  return separator < 0
    ? { filename: normalized, directory: "" }
    : {
        filename: normalized.slice(separator + 1) || normalized,
        directory: normalized.slice(0, separator + 1),
      };
}

/** Display the changed file relative to the project root. */
export function messageFileChangeDisplayPath(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/").replace(/^\.\/+|^\/+|\/+$/gu, "");
  return normalized ? `./${normalized}` : "./";
}

/** Read the runtime-neutral workspace diff projected onto this assistant message. */
export function messageFileChanges(node: MessageRendererNode): MessageFileChanges | undefined {
  const changeSet = parseWorkbenchFileChangeSet(
    node.presentation?.custom?.[WORKBENCH_FILE_CHANGE_SET_PRESENTATION_KEY],
  );
  if (!changeSet || changeSet.totalFiles === 0) return undefined;
  return {
    ...changeSet,
    files: changeSet.files.map((file) => ({
      ...file,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      ...splitMessageFileChangePath(file.path),
    })),
  };
}
