import type { OpenHandlerDefinition } from "@/platform/extensions";
import { readPiSkillFile } from "@/runtime/pi/client/transport/api";
import { fileWorkspaceContext, fileWorkspaceService } from "@/services/workspace-file-service";

import { fileDiffService, parseFileDiffMetadata } from "./file-diff-service";
import { defaultFileViewMode } from "./file-view-mode";

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function metadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
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

export const skillFileOpenHandler = {
  id: "workspace.file.skill",
  canOpen: ({ resource }) =>
    resource.scheme === "skill-file" &&
    resource.path.trim() &&
    metadataString(resource.metadata, "sessionId") &&
    metadataString(resource.metadata, "skillName") &&
    metadataString(resource.metadata, "relativePath")
      ? 100
      : 0,
  open: async ({ resource, context, scope, policy }, { surfaces }) => {
    const sessionId = metadataString(resource.metadata, "sessionId");
    const skillName = metadataString(resource.metadata, "skillName");
    const relativePath = metadataString(resource.metadata, "relativePath");
    if (!sessionId || !skillName || !relativePath) {
      throw new Error("A Skill file requires a session id, Skill name, and relative path");
    }

    const targetScope =
      scope ??
      (context.threadId
        ? { type: "thread" as const, key: context.threadId }
        : { type: "application" as const, key: context.applicationId });
    const skillFile = await readPiSkillFile({ sessionId, name: skillName, relativePath });
    const snapshot = fileWorkspaceService.attachFile(
      { scope: targetScope, rootPath: skillFile.rootPath },
      skillFile.absolutePath,
      skillFile.content,
    );

    return surfaces.reveal({
      kind: "file",
      title: resource.label ?? snapshot.name,
      params: {
        source: "skill",
        rootPath: skillFile.rootPath,
        sessionId,
        skillName,
        readOnly: true,
        absolutePath: skillFile.absolutePath,
        relativePath: skillFile.relativePath,
        name: skillFile.name,
        mediaType: skillFile.mediaType,
        encoding: skillFile.encoding,
        version: skillFile.version,
        size: skillFile.size,
        modifiedAt: skillFile.modifiedAt,
        viewMode: "source",
        diffId: undefined,
        diffCycle: undefined,
      },
      context,
      scope: targetScope,
      status: "ready",
      policy: policy ?? "force-focus",
    });
  },
} satisfies OpenHandlerDefinition;
