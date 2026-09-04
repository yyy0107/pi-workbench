import type { OpenHandlerDefinition } from "@workbench/extension-sdk";
import {
  fileWorkspaceContext,
  type FileWorkspaceService,
  type FileDiffService,
} from "@workbench/shell/workspace-files";
import { parseFileDiffMetadata } from "./file-diff-service";
import { defaultFileViewMode } from "./file-view-mode";

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function createFileOpenHandler(
  files: FileWorkspaceService,
  diffs: FileDiffService,
): OpenHandlerDefinition {
  const fileOpenHandler = {
    id: "workspace.file",
    canOpen: ({ resource }) =>
      resource.scheme === "workspace-file" && resource.path.trim() ? 100 : 0,
    open: async ({ resource, context, scope, policy }, { surfaces }) => {
      const targetScope =
        scope ??
        (context.threadId
          ? { type: "thread" as const, key: context.threadId }
          : { type: "application" as const, key: context.applicationId });
      const rootPath = context.rootPath;
      const workspaceId = context.worktreeId ?? context.projectId;
      if (!rootPath || !workspaceId) {
        throw new Error("A workspace file requires an explicit workspace root and identity");
      }
      const fileSession = { source: "workspace" as const, rootPath, workspaceId };
      const fileContext = fileWorkspaceContext(targetScope, fileSession);
      const descriptor = await files.describeFile(fileContext, resource.path);
      const requestedDiff = parseFileDiffMetadata(resource.metadata);
      const diff = requestedDiff ? diffs.upsert(descriptor.path, requestedDiff) : undefined;
      return surfaces.reveal({
        kind: "file",
        title: resource.label ?? descriptor.name ?? fileName(resource.path),
        params: {
          ...fileSession,
          absolutePath: descriptor.path,
          ...(descriptor.relativePath ? { relativePath: descriptor.relativePath } : {}),
          name: descriptor.name,
          mediaType: descriptor.mediaType,
          encoding: descriptor.encoding,
          version: descriptor.version,
          size: descriptor.size,
          modifiedAt: descriptor.modifiedAt,
          ...(descriptor.contentUrl ? { contentUrl: descriptor.contentUrl } : {}),
          viewMode: diff ? "diff" : defaultFileViewMode(descriptor.path, descriptor.encoding),
          diffId: diff?.id,
          diffCycle: diff?.cycle,
        },
        context,
        scope: targetScope,
        status: "ready",
        policy: policy ?? "reveal",
      });
    },
  } satisfies OpenHandlerDefinition;

  return fileOpenHandler;
}
