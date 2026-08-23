import type { OpenHandlerDefinition } from "@/platform/extensions";
import { fileWorkspaceContext, fileWorkspaceService } from "@/services/workspace-file-service";

import { fileDiffService, parseFileDiffMetadata } from "./file-diff-service";
import { defaultFileViewMode } from "./file-view-mode";

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export const fileOpenHandler = {
  id: "workspace.file",
  canOpen: ({ resource }) =>
    (resource.scheme === "file" || resource.scheme === "workspace-file") && resource.path.trim()
      ? 100
      : 0,
  open: async ({ resource, context, scope, policy }, { surfaces }) => {
    const targetScope =
      scope ??
      (context.threadId
        ? { type: "thread" as const, key: context.threadId }
        : { type: "application" as const, key: context.applicationId });
    const fileContext = fileWorkspaceContext(targetScope, context);
    const descriptor = await fileWorkspaceService.describeFile(fileContext, resource.path);
    const requestedDiff = parseFileDiffMetadata(resource.metadata);
    const diff = requestedDiff ? fileDiffService.upsert(descriptor.path, requestedDiff) : undefined;
    return surfaces.reveal({
      kind: "file",
      title: resource.label ?? descriptor.name ?? fileName(resource.path),
      params: {
        absolutePath: descriptor.path,
        ...(descriptor.relativePath ? { relativePath: descriptor.relativePath } : {}),
        ...(descriptor.workspaceId ? { workspaceId: descriptor.workspaceId } : {}),
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
