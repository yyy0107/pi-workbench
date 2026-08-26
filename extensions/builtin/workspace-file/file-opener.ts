import type { OpenHandlerDefinition } from "@/platform/extensions";
import {
  listPiExtensionFiles,
  listPiSkillFiles,
  readPiExtensionFile,
  readPiSkillFile,
} from "@/runtime/pi/client/transport/api";
import type {
  ExtensionFileReadPayload,
  ExtensionSourceOrigin,
  ExtensionSourceScope,
  PiResourceCatalogTarget,
  PiResourceRequest,
} from "@/runtime/pi/rpc-contracts";
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

function extensionFileIdentity(
  metadata: Readonly<Record<string, unknown>> | undefined,
): ExtensionFileReadPayload | undefined {
  const request = resourceRequest(metadata);
  const name = metadataString(metadata, "extensionName");
  const filePath = metadataString(metadata, "extensionFilePath");
  const source = metadataString(metadata, "extensionSource");
  const scope = metadataString(metadata, "extensionScope") as ExtensionSourceScope | undefined;
  const origin = metadataString(metadata, "extensionOrigin") as ExtensionSourceOrigin | undefined;
  const relativePath = metadataString(metadata, "relativePath");
  if (
    !request ||
    !name ||
    !filePath ||
    !source ||
    !scope ||
    !["user", "project", "temporary"].includes(scope) ||
    !origin ||
    !["package", "top-level"].includes(origin)
  ) {
    return undefined;
  }
  return {
    ...request,
    name,
    filePath,
    source,
    scope,
    origin,
    ...(relativePath ? { relativePath } : {}),
  };
}

function resourceCatalogTarget(value: unknown): PiResourceCatalogTarget | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Readonly<Record<string, unknown>>;
  if (candidate.scope === "user") return { scope: "user" };
  const workspaceId =
    typeof candidate.workspaceId === "string" && candidate.workspaceId.trim()
      ? candidate.workspaceId
      : undefined;
  return candidate.scope === "project" && workspaceId
    ? { scope: "project", workspaceId }
    : undefined;
}

function resourceRequest(
  metadata: Readonly<Record<string, unknown>> | undefined,
): PiResourceRequest | undefined {
  const target = resourceCatalogTarget(metadata?.resourceTarget);
  if (target) return { target };
  const sessionId = metadataString(metadata, "sessionId");
  return sessionId ? { sessionId } : undefined;
}

function resourceSessionIdentity(
  request: PiResourceRequest,
): { resourceTarget: PiResourceCatalogTarget } | { sessionId: string } {
  return request.target ? { resourceTarget: request.target } : { sessionId: request.sessionId };
}

export const fileOpenHandler = {
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
    const descriptor = await fileWorkspaceService.describeFile(fileContext, resource.path);
    const requestedDiff = parseFileDiffMetadata(resource.metadata);
    const diff = requestedDiff ? fileDiffService.upsert(descriptor.path, requestedDiff) : undefined;
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

export const skillFileOpenHandler = {
  id: "workspace.file.skill",
  canOpen: ({ resource }) =>
    resource.scheme === "skill-file" &&
    resource.path.trim() &&
    resourceRequest(resource.metadata) &&
    metadataString(resource.metadata, "skillName") &&
    metadataString(resource.metadata, "relativePath")
      ? 100
      : 0,
  open: async ({ resource, context, scope, policy }, { surfaces }) => {
    const request = resourceRequest(resource.metadata);
    const skillName = metadataString(resource.metadata, "skillName");
    const relativePath = metadataString(resource.metadata, "relativePath");
    if (!request || !skillName || !relativePath) {
      throw new Error("A Skill file requires a resource scope, Skill name, and relative path");
    }

    const targetScope =
      scope ??
      (context.threadId
        ? { type: "thread" as const, key: context.threadId }
        : { type: "application" as const, key: context.applicationId });
    const skillFile = await readPiSkillFile({ ...request, name: skillName, relativePath });
    const fileSession = {
      source: "skill" as const,
      rootPath: skillFile.rootPath,
      ...resourceSessionIdentity(request),
      skillName,
    };
    const snapshot = fileWorkspaceService.attachFile(
      fileWorkspaceContext(targetScope, fileSession),
      skillFile.absolutePath,
      skillFile.content,
    );

    return surfaces.reveal({
      kind: "file",
      title: resource.label ?? snapshot.name,
      params: {
        ...fileSession,
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

export const skillDirectoryOpenHandler = {
  id: "workspace.directory.skill",
  canOpen: ({ resource }) =>
    resource.scheme === "skill-directory" &&
    resource.path.trim() &&
    resourceRequest(resource.metadata) &&
    metadataString(resource.metadata, "skillName")
      ? 100
      : 0,
  open: async ({ resource, context, scope, policy }, { surfaces }) => {
    const request = resourceRequest(resource.metadata);
    const skillName = metadataString(resource.metadata, "skillName");
    if (!request || !skillName) {
      throw new Error("A Skill directory requires a resource scope and Skill name");
    }
    const listing = await listPiSkillFiles({ ...request, name: skillName });
    const targetScope =
      scope ??
      (context.threadId
        ? { type: "thread" as const, key: context.threadId }
        : { type: "application" as const, key: context.applicationId });
    return surfaces.reveal({
      kind: "file",
      title: resource.label ?? skillName,
      params: {
        source: "skill",
        rootPath: listing.rootPath,
        ...resourceSessionIdentity(request),
        skillName,
      },
      context,
      scope: targetScope,
      status: "ready",
      policy: policy ?? "force-focus",
    });
  },
} satisfies OpenHandlerDefinition;

export const extensionFileOpenHandler = {
  id: "workspace.file.extension",
  canOpen: ({ resource }) => {
    const identity = extensionFileIdentity(resource.metadata);
    return resource.scheme === "extension-file" &&
      resource.path.trim() &&
      identity &&
      identity.relativePath
      ? 100
      : 0;
  },
  open: async ({ resource, context, scope, policy }, { surfaces }) => {
    const identity = extensionFileIdentity(resource.metadata);
    if (!identity?.relativePath) {
      throw new Error(
        "An extension file requires its directory-session identity and relative path",
      );
    }

    const targetScope =
      scope ??
      (context.threadId
        ? { type: "thread" as const, key: context.threadId }
        : { type: "application" as const, key: context.applicationId });
    const extensionFile = await readPiExtensionFile(identity);
    const fileSession = {
      source: "extension" as const,
      rootPath: extensionFile.rootPath,
      ...resourceSessionIdentity(identity),
      extensionName: identity.name,
      extensionFilePath: identity.filePath,
      extensionSource: identity.source,
      extensionScope: identity.scope,
      extensionOrigin: identity.origin,
    };
    const snapshot = fileWorkspaceService.attachFile(
      fileWorkspaceContext(targetScope, fileSession),
      extensionFile.absolutePath,
      extensionFile.content,
    );

    return surfaces.reveal({
      kind: "file",
      title: resource.label ?? snapshot.name,
      params: {
        ...fileSession,
        absolutePath: extensionFile.absolutePath,
        relativePath: extensionFile.relativePath,
        name: extensionFile.name,
        mediaType: extensionFile.mediaType,
        encoding: extensionFile.encoding,
        version: extensionFile.version,
        size: extensionFile.size,
        modifiedAt: extensionFile.modifiedAt,
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

export const extensionDirectoryOpenHandler = {
  id: "workspace.directory.extension",
  canOpen: ({ resource }) => {
    const identity = extensionFileIdentity(resource.metadata);
    return resource.scheme === "extension-directory" && resource.path.trim() && identity ? 100 : 0;
  },
  open: async ({ resource, context, scope, policy }, { surfaces }) => {
    const identity = extensionFileIdentity(resource.metadata);
    if (!identity) {
      throw new Error("An extension directory requires its complete resolved extension identity");
    }
    const listing = await listPiExtensionFiles(identity);
    const targetScope =
      scope ??
      (context.threadId
        ? { type: "thread" as const, key: context.threadId }
        : { type: "application" as const, key: context.applicationId });
    return surfaces.reveal({
      kind: "file",
      title: resource.label ?? identity.name,
      params: {
        source: "extension",
        rootPath: listing.rootPath,
        ...resourceSessionIdentity(identity),
        extensionName: identity.name,
        extensionFilePath: identity.filePath,
        extensionSource: identity.source,
        extensionScope: identity.scope,
        extensionOrigin: identity.origin,
      },
      context,
      scope: targetScope,
      status: "ready",
      policy: policy ?? "force-focus",
    });
  },
} satisfies OpenHandlerDefinition;
