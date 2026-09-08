import type { OpenableResource, WorkspaceScope } from "@workbench/extension-sdk";

export interface WorkspaceFileSession {
  source: "workspace";
  rootPath: string;
  workspaceId: string;
}

export interface LocalFileSession {
  source: "local";
  rootPath: string;
}

export type FileContentTarget =
  | { source: "workspace"; workspaceId: string; relativePath: string }
  | { source: "local"; path: string };

export type ResourceCatalogTarget = { scope: "user" } | { scope: "project"; workspaceId: string };

type ResourceCatalogIdentity =
  | { resourceTarget: ResourceCatalogTarget; sessionId?: never }
  | { sessionId: string; resourceTarget?: never };

export type SkillFileSession = ResourceCatalogIdentity & {
  source: "skill";
  rootPath: string;
  skillName: string;
};

export type ExtensionFileSession = ResourceCatalogIdentity & {
  source: "extension";
  rootPath: string;
  extensionName: string;
  extensionFilePath: string;
  extensionSource: string;
  extensionScope: "user" | "project" | "temporary";
  extensionOrigin: "package" | "top-level";
};

export type ResourceFileSession = SkillFileSession | ExtensionFileSession;
export type FileWorkspaceSession = WorkspaceFileSession | LocalFileSession | ResourceFileSession;

export interface WorkspaceFileContext {
  scope: WorkspaceScope;
  workspaceId?: string;
  rootPath?: string;
  session?: FileWorkspaceSession;
}

export interface FileNode {
  path: string;
  relativePath: string;
  name: string;
  kind: "file" | "directory";
  hidden: boolean;
  symbolicLink?: boolean;
}

export interface FileDirectoryListing {
  path: string;
  relativePath: string;
  nodes: readonly FileNode[];
  truncated: boolean;
}

export interface FileSnapshot {
  path: string;
  relativePath?: string;
  workspaceId?: string;
  source: "memory" | "workspace" | "local" | "resource";
  name: string;
  content: string;
  savedContent: string;
  version: string;
  modifiedAt: number;
  size: number;
}

export interface FileDescriptor {
  path: string;
  relativePath?: string;
  workspaceId?: string;
  source: "memory" | "workspace" | "local" | "resource";
  name: string;
  mediaType: string;
  encoding: "utf-8" | null;
  version: string;
  modifiedAt: number;
  size: number;
  contentUrl?: string;
}

export type Unsubscribe = () => void;

export interface FileWorkspaceService {
  listDirectory(context: WorkspaceFileContext, path: string): Promise<FileDirectoryListing>;
  describeFile(context: WorkspaceFileContext, path: string): Promise<FileDescriptor>;
  readFile(context: WorkspaceFileContext, path: string): Promise<FileSnapshot>;
  writeFile(
    context: WorkspaceFileContext,
    path: string,
    content: string,
    version: string,
  ): Promise<FileSnapshot>;
  watchPath(context: WorkspaceFileContext, path: string, listener: () => void): Unsubscribe;
  importFile(context: WorkspaceFileContext, file: File, rootPath?: string): Promise<FileSnapshot>;
  attachFile(context: WorkspaceFileContext, path: string, content: string): FileSnapshot;
  updateBuffer(context: WorkspaceFileContext, path: string, content: string): void;
  getSnapshot(context: WorkspaceFileContext, path: string): FileSnapshot | undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function resourceCatalogTarget(value: unknown): ResourceCatalogTarget | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Readonly<Record<string, unknown>>;
  if (candidate.scope === "user") return { scope: "user" };
  const workspaceId = nonEmptyString(candidate.workspaceId);
  return candidate.scope === "project" && workspaceId
    ? { scope: "project", workspaceId }
    : undefined;
}

function resourceCatalogIdentity(
  params: Readonly<Record<string, unknown>>,
): ResourceCatalogIdentity | undefined {
  const target = resourceCatalogTarget(params.resourceTarget);
  if (target) return { resourceTarget: target };
  const sessionId = nonEmptyString(params.sessionId);
  return sessionId ? { sessionId } : undefined;
}

function resourceRequest(
  session: ResourceCatalogIdentity,
): { target: ResourceCatalogTarget } | { sessionId: string } {
  return session.resourceTarget
    ? { target: session.resourceTarget }
    : { sessionId: session.sessionId };
}

function resourceMetadata(
  session: ResourceCatalogIdentity,
): { resourceTarget: ResourceCatalogTarget } | { sessionId: string } {
  return session.resourceTarget
    ? { resourceTarget: session.resourceTarget }
    : { sessionId: session.sessionId };
}

/** Resolve the complete identity shared by File, Explorer, and their resource openers. */
export function resolveFileWorkspaceSession(
  params: Readonly<Record<string, unknown>>,
): FileWorkspaceSession | undefined {
  if (params.source === "local") {
    const rootPath = nonEmptyString(params.rootPath);
    return rootPath ? { source: "local", rootPath } : undefined;
  }
  if (params.source === "workspace") {
    const rootPath = nonEmptyString(params.rootPath);
    const workspaceId = nonEmptyString(params.workspaceId);
    return rootPath && workspaceId ? { source: "workspace", rootPath, workspaceId } : undefined;
  }

  if (params.source === "skill") {
    const rootPath = nonEmptyString(params.rootPath);
    const identity = resourceCatalogIdentity(params);
    const skillName = nonEmptyString(params.skillName);
    return rootPath && identity && skillName
      ? { source: "skill", rootPath, ...identity, skillName }
      : undefined;
  }

  if (params.source === "extension") {
    const rootPath = nonEmptyString(params.rootPath);
    const identity = resourceCatalogIdentity(params);
    const extensionName = nonEmptyString(params.extensionName);
    const extensionFilePath = nonEmptyString(params.extensionFilePath);
    const extensionSource = nonEmptyString(params.extensionSource);
    const extensionScope =
      params.extensionScope === "user" ||
      params.extensionScope === "project" ||
      params.extensionScope === "temporary"
        ? params.extensionScope
        : undefined;
    const extensionOrigin =
      params.extensionOrigin === "package" || params.extensionOrigin === "top-level"
        ? params.extensionOrigin
        : undefined;
    return rootPath &&
      identity &&
      extensionName &&
      extensionFilePath &&
      extensionSource &&
      extensionScope &&
      extensionOrigin
      ? {
          source: "extension",
          rootPath,
          ...identity,
          extensionName,
          extensionFilePath,
          extensionSource,
          extensionScope,
          extensionOrigin,
        }
      : undefined;
  }

  return undefined;
}

export function fileWorkspaceContext(
  scope: WorkspaceScope,
  session: FileWorkspaceSession,
): WorkspaceFileContext {
  return {
    scope,
    session,
    rootPath: session.rootPath,
    ...(session.source === "workspace" ? { workspaceId: session.workspaceId } : {}),
  };
}

export function fileWorkspaceSessionKey(session: FileWorkspaceSession): string {
  if (session.source === "local") return JSON.stringify(["local", session.rootPath]);
  if (session.source === "workspace") {
    return JSON.stringify(["workspace", session.workspaceId, session.rootPath]);
  }
  if (session.source === "skill") {
    return JSON.stringify(["skill", resourceRequest(session), session.skillName, session.rootPath]);
  }
  return JSON.stringify([
    "extension",
    resourceRequest(session),
    session.extensionName,
    session.extensionFilePath,
    session.extensionSource,
    session.extensionScope,
    session.extensionOrigin,
    session.rootPath,
  ]);
}

export function fileWorkspaceOpenableResource(
  session: FileWorkspaceSession,
  file: Pick<FileNode, "path" | "relativePath" | "name">,
): OpenableResource {
  if (session.source === "local") return { scheme: "file", path: file.path, label: file.name };
  if (session.source === "skill") {
    return {
      scheme: "skill-file",
      path: file.path,
      label: file.name,
      metadata: {
        ...resourceMetadata(session),
        skillName: session.skillName,
        relativePath: file.relativePath,
      },
    };
  }
  if (session.source === "extension") {
    return {
      scheme: "extension-file",
      path: file.path,
      label: file.name,
      metadata: {
        ...resourceMetadata(session),
        extensionName: session.extensionName,
        extensionFilePath: session.extensionFilePath,
        extensionSource: session.extensionSource,
        extensionScope: session.extensionScope,
        extensionOrigin: session.extensionOrigin,
        relativePath: file.relativePath,
      },
    };
  }
  return {
    scheme: "workspace-file",
    path: file.relativePath || file.path,
    label: file.name,
  };
}
