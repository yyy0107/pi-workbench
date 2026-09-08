import type { OpenHandlerDefinition } from "@workbench/extension-sdk";
import {
  fileWorkspaceContext,
  workspaceRelativePath,
  type FileWorkspaceService,
  type FileDiffService,
  type LocalFileSession,
  type WorkspaceFileSession,
} from "@workbench/shell/workspace-files";
import { parseFileDiffMetadata } from "./file-diff-service";
import { defaultFileViewMode } from "./file-view-mode";

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function parentPath(path: string): string {
  const parent = path.replace(/[\\/][^\\/]*$/, "");
  return /^[a-z]:$/i.test(parent) ? `${parent}/` : parent || "/";
}

export function createFileOpenHandler(
  files: FileWorkspaceService,
  diffs: FileDiffService,
): OpenHandlerDefinition {
  const fileOpenHandler = {
    id: "workspace.file",
    canOpen: ({ resource }) =>
      (resource.scheme === "workspace-file" || resource.scheme === "file") && resource.path.trim()
        ? 100
        : 0,
    open: async ({ resource, context, scope, policy }, { surfaces }) => {
      const targetScope =
        scope ??
        (context.threadId
          ? { type: "thread" as const, key: context.threadId }
          : { type: "application" as const, key: context.applicationId });
      const rootPath = context.rootPath;
      const workspaceId = context.worktreeId ?? context.projectId;
      let withinWorkspace = Boolean(rootPath && workspaceId);
      if (resource.scheme === "file") {
        if (!/^(?:\/(?!\/)|[a-z]:[\\/]|~[\\/])/i.test(resource.path)) {
          throw new Error("A local file requires an absolute path");
        }
        try {
          if (resource.path.startsWith("~")) withinWorkspace = false;
          else workspaceRelativePath(rootPath, resource.path);
        } catch {
          withinWorkspace = false;
        }
      } else if (!withinWorkspace) {
        throw new Error("A workspace file requires an explicit workspace root and identity");
      }
      let fileSession: WorkspaceFileSession | LocalFileSession = withinWorkspace
        ? { source: "workspace", rootPath: rootPath!, workspaceId: workspaceId! }
        : { source: "local", rootPath: parentPath(resource.path) };
      const fileContext =
        fileSession.source === "local"
          ? { scope: targetScope, session: fileSession }
          : fileWorkspaceContext(targetScope, fileSession);
      const descriptor = await files.describeFile(fileContext, resource.path);
      if (fileSession.source === "local")
        fileSession = { source: "local", rootPath: parentPath(descriptor.path) };
      const relativePath =
        descriptor.relativePath ??
        (fileSession.source === "local" ? fileName(descriptor.path) : undefined);
      const requestedDiff = parseFileDiffMetadata(resource.metadata);
      const diff = requestedDiff ? diffs.upsert(descriptor.path, requestedDiff) : undefined;
      return surfaces.reveal({
        kind: "file",
        title: resource.label ?? descriptor.name ?? fileName(resource.path),
        params: {
          ...fileSession,
          absolutePath: descriptor.path,
          ...(relativePath ? { relativePath } : {}),
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
