import type { OpenableResource, WorkspaceScope } from "@workbench/extension-sdk";
import type {
  ExtensionFileReadPayload,
  ExtensionFileSnapshotValue,
  ExtensionFilesListPayload,
  ExtensionFilesListValue,
  ExtensionSourceOrigin,
  ExtensionSourceScope,
  PiResourceCatalogTarget,
  PiResourceRequest,
  SkillFileReadPayload,
  SkillFileSnapshotValue,
  SkillFilesListPayload,
  SkillFilesListValue,
  WorkspaceFileDescribePayload,
  WorkspaceFileDescriptorValue,
  WorkspaceFileReadPayload,
  WorkspaceFileSnapshotValue,
  WorkspaceFilesListPayload,
  WorkspaceFilesListValue,
  WorkspaceFileWritePayload,
} from "@workbench/agent-runtime-pi-protocol/rpc";

export interface WorkspaceFileSession {
  source: "workspace";
  rootPath: string;
  workspaceId: string;
}

type ResourceCatalogIdentity =
  | { resourceTarget: PiResourceCatalogTarget; sessionId?: never }
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
  extensionScope: ExtensionSourceScope;
  extensionOrigin: ExtensionSourceOrigin;
};

export type ResourceFileSession = SkillFileSession | ExtensionFileSession;
export type FileWorkspaceSession = WorkspaceFileSession | ResourceFileSession;

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
  source: "memory" | "workspace" | "resource";
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
  source: "memory" | "workspace" | "resource";
  name: string;
  mediaType: string;
  encoding: "utf-8" | null;
  version: string;
  modifiedAt: number;
  size: number;
  contentUrl?: string;
}

export type Unsubscribe = () => void;

export interface FileWorkspaceBackend {
  /** Same-origin browser preview URL; desktop sidecars deliberately return `undefined`. */
  contentUrl?(payload: WorkspaceFileDescribePayload): string | undefined;
  listDirectory(payload: WorkspaceFilesListPayload): Promise<WorkspaceFilesListValue>;
  describeFile(payload: WorkspaceFileDescribePayload): Promise<WorkspaceFileDescriptorValue>;
  readFile(payload: WorkspaceFileReadPayload): Promise<WorkspaceFileSnapshotValue>;
  writeFile(payload: WorkspaceFileWritePayload): Promise<WorkspaceFileSnapshotValue>;
  listSkillDirectory?(payload: SkillFilesListPayload): Promise<SkillFilesListValue>;
  readSkillFile?(payload: SkillFileReadPayload): Promise<SkillFileSnapshotValue>;
  listExtensionDirectory?(payload: ExtensionFilesListPayload): Promise<ExtensionFilesListValue>;
  readExtensionFile?(payload: ExtensionFileReadPayload): Promise<ExtensionFileSnapshotValue>;
}

/**
 * Shared file capability used by file-oriented contributions.
 *
 * `scope` isolates browser buffers between Workbench contexts. The resolved session carries either
 * the authoritative `workspaceId` or the complete Skill/Extension identity used for filesystem
 * access; neither may be inferred from the scope key.
 */
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

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function nextVersion(): string {
  return `memory:${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isAbsoluteWorkspacePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\\\") || /^[a-zA-Z]:[\\/]/.test(path);
}

function normalizeRelativePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`File path is outside the workspace: ${path}`);
  }
  return segments.join("/");
}

function normalizedAbsolutePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

function normalizedPathKey(path: string): string {
  const normalized = normalizedAbsolutePath(path);
  return /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}

function isDescendantPath(parentKey: string, candidateKey: string): boolean {
  if (parentKey === "/") return candidateKey.startsWith("/") && candidateKey !== parentKey;
  return candidateKey.startsWith(`${parentKey}/`);
}

export function workspaceRelativePath(rootPath: string | undefined, path: string): string {
  if (!isAbsoluteWorkspacePath(path)) return normalizeRelativePath(path);
  if (!rootPath) throw new Error(`Workspace root is unavailable for ${path}`);

  const root = normalizedAbsolutePath(rootPath);
  const target = normalizedAbsolutePath(path);
  const caseInsensitive = /^[a-zA-Z]:\//.test(root);
  const comparableRoot = caseInsensitive ? root.toLowerCase() : root;
  const comparableTarget = caseInsensitive ? target.toLowerCase() : target;
  if (comparableTarget === comparableRoot) return "";
  const prefix = comparableRoot === "/" ? "/" : `${comparableRoot}/`;
  if (!comparableTarget.startsWith(prefix)) {
    throw new Error(`File path is outside the workspace: ${path}`);
  }
  return normalizeRelativePath(target.slice(prefix.length));
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function resourceCatalogTarget(value: unknown): PiResourceCatalogTarget | undefined {
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

function resourceRequest(session: ResourceCatalogIdentity): PiResourceRequest {
  return session.resourceTarget
    ? { target: session.resourceTarget }
    : { sessionId: session.sessionId };
}

function resourceMetadata(
  session: ResourceCatalogIdentity,
): { resourceTarget: PiResourceCatalogTarget } | { sessionId: string } {
  return session.resourceTarget
    ? { resourceTarget: session.resourceTarget }
    : { sessionId: session.sessionId };
}

/**
 * Resolves the complete identity shared by File Surface chrome, breadcrumbs, Explorer, and file
 * reads. An incomplete resource identity deliberately resolves to undefined so those capabilities
 * cannot drift into independently enabled states.
 */
export function resolveFileWorkspaceSession(
  params: Readonly<Record<string, unknown>>,
): FileWorkspaceSession | undefined {
  if (params.source === "workspace") {
    const rootPath = nonEmptyString(params.rootPath);
    const workspaceId = nonEmptyString(params.workspaceId);
    if (!rootPath || !workspaceId) return undefined;
    return { source: "workspace", rootPath, workspaceId };
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

function workspaceAbsolutePath(rootPath: string | undefined, path: string): string {
  if (isAbsoluteWorkspacePath(path) || !rootPath) return path;
  const relativePath = normalizeRelativePath(path);
  const separator = rootPath.includes("\\") && !rootPath.includes("/") ? "\\" : "/";
  const root = rootPath.replace(/[\\/]+$/, "");
  return relativePath ? `${root}${separator}${relativePath.replaceAll("/", separator)}` : rootPath;
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

function snapshotFromRemote(value: WorkspaceFileSnapshotValue): FileSnapshot {
  return {
    path: value.absolutePath,
    relativePath: value.relativePath,
    workspaceId: value.workspaceId,
    source: "workspace",
    name: value.name,
    content: value.content,
    savedContent: value.content,
    version: value.version,
    modifiedAt: value.modifiedAt,
    size: value.size,
  };
}

function descriptorFromRemote(
  value: WorkspaceFileDescriptorValue,
  contentUrl?: FileWorkspaceBackend["contentUrl"],
): FileDescriptor {
  const previewUrl = contentUrl?.({
    workspaceId: value.workspaceId,
    relativePath: value.relativePath,
  });
  return {
    path: value.absolutePath,
    relativePath: value.relativePath,
    workspaceId: value.workspaceId,
    source: "workspace",
    name: value.name,
    mediaType: value.mediaType,
    encoding: value.encoding,
    version: value.version,
    modifiedAt: value.modifiedAt,
    size: value.size,
    ...(previewUrl ? { contentUrl: previewUrl } : {}),
  };
}

function descriptorFromSnapshot(snapshot: FileSnapshot): FileDescriptor {
  return {
    path: snapshot.path,
    ...(snapshot.relativePath ? { relativePath: snapshot.relativePath } : {}),
    ...(snapshot.workspaceId ? { workspaceId: snapshot.workspaceId } : {}),
    source: snapshot.source,
    name: snapshot.name,
    mediaType: "text/plain",
    encoding: "utf-8",
    version: snapshot.version,
    modifiedAt: snapshot.modifiedAt,
    size: snapshot.size,
  };
}

function compareNodes(left: FileNode, right: FileNode): number {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
  return left.name.localeCompare(right.name, "en-US", { numeric: true, sensitivity: "base" });
}

function resourceDirectoryListing(
  rootPath: string,
  listing: Pick<SkillFilesListValue, "relativePath" | "entries" | "truncated">,
): FileDirectoryListing {
  return {
    path: workspaceAbsolutePath(rootPath, listing.relativePath),
    relativePath: listing.relativePath,
    nodes: listing.entries.map((entry) => ({
      path: workspaceAbsolutePath(rootPath, entry.relativePath),
      relativePath: entry.relativePath,
      name: entry.name,
      kind: entry.kind,
      hidden: entry.hidden,
      ...(entry.symbolicLink ? { symbolicLink: true } : {}),
    })),
    truncated: listing.truncated,
  };
}

function resourceSnapshot(
  value: SkillFileSnapshotValue | ExtensionFileSnapshotValue,
): FileSnapshot {
  return {
    path: value.absolutePath,
    relativePath: value.relativePath,
    source: "resource",
    name: value.name,
    content: value.content,
    savedContent: value.content,
    version: value.version,
    modifiedAt: value.modifiedAt,
    size: value.size,
  };
}

export function fileWorkspaceOpenableResource(
  session: FileWorkspaceSession,
  file: Pick<FileNode, "path" | "relativePath" | "name">,
): OpenableResource {
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

export class BufferedFileWorkspaceService implements FileWorkspaceService {
  readonly #files = new Map<string, Map<string, FileSnapshot>>();
  readonly #listeners = new Map<string, Map<string, Set<() => void>>>();
  readonly #backend?: FileWorkspaceBackend;

  constructor(backend?: FileWorkspaceBackend) {
    this.#backend = backend;
  }

  async listDirectory(context: WorkspaceFileContext, path: string): Promise<FileDirectoryListing> {
    if (context.session?.source === "skill") {
      if (!this.#backend?.listSkillDirectory) {
        throw new Error("The Skill file backend is unavailable");
      }
      const listing = await this.#backend.listSkillDirectory({
        ...resourceRequest(context.session),
        name: context.session.skillName,
        relativePath: workspaceRelativePath(context.rootPath, path),
      });
      return resourceDirectoryListing(listing.rootPath, listing);
    }
    if (context.session?.source === "extension") {
      if (!this.#backend?.listExtensionDirectory) {
        throw new Error("The extension file backend is unavailable");
      }
      const listing = await this.#backend.listExtensionDirectory({
        ...resourceRequest(context.session),
        name: context.session.extensionName,
        filePath: context.session.extensionFilePath,
        source: context.session.extensionSource,
        scope: context.session.extensionScope,
        origin: context.session.extensionOrigin,
        relativePath: workspaceRelativePath(context.rootPath, path),
      });
      return resourceDirectoryListing(listing.rootPath, listing);
    }
    if (context.workspaceId && this.#backend) {
      const listing = await this.#backend.listDirectory({
        workspaceId: context.workspaceId,
        relativePath: workspaceRelativePath(context.rootPath, path),
      });
      return {
        path: listing.absolutePath,
        relativePath: listing.relativePath,
        nodes: listing.entries.map((entry) => ({
          path: entry.absolutePath,
          relativePath: entry.relativePath,
          name: entry.name,
          kind: entry.kind,
          hidden: entry.hidden,
          ...(entry.symbolicLink ? { symbolicLink: true } : {}),
        })),
        truncated: listing.truncated,
      };
    }

    const directoryPath = workspaceAbsolutePath(context.rootPath, path).replace(/[\\/]+$/, "");
    const prefix = directoryPath ? `${directoryPath}/` : "";
    const nodes = new Map<string, FileNode>();
    for (const file of this.#files.get(this.scopeKey(context.scope))?.values() ?? []) {
      const normalizedFilePath = file.path.replaceAll("\\", "/");
      const normalizedPrefix = prefix.replaceAll("\\", "/");
      if (!normalizedFilePath.startsWith(normalizedPrefix)) continue;
      const descendantPath = normalizedFilePath.slice(normalizedPrefix.length);
      const [name, ...remaining] = descendantPath.split("/").filter(Boolean);
      if (!name) continue;
      const nodePath = remaining.length ? `${normalizedPrefix}${name}` : file.path;
      const kind = remaining.length ? "directory" : "file";
      const existing = nodes.get(name);
      if (existing?.kind === "directory") continue;
      nodes.set(name, {
        path: nodePath,
        relativePath: workspaceRelativePath(context.rootPath ?? directoryPath, nodePath),
        name,
        kind,
        hidden: name.startsWith("."),
      });
    }
    return {
      path: directoryPath,
      relativePath: workspaceRelativePath(context.rootPath ?? directoryPath, directoryPath),
      nodes: [...nodes.values()].sort(compareNodes),
      truncated: false,
    };
  }

  async describeFile(context: WorkspaceFileContext, path: string): Promise<FileDescriptor> {
    const snapshot = this.getSnapshot(context, path);
    if (snapshot && snapshot.content !== snapshot.savedContent) {
      return descriptorFromSnapshot(snapshot);
    }
    if (context.workspaceId && this.#backend) {
      const descriptor = await this.#backend.describeFile({
        workspaceId: context.workspaceId,
        relativePath: workspaceRelativePath(context.rootPath, path),
      });
      return descriptorFromRemote(descriptor, this.#backend.contentUrl);
    }
    if (context.session?.source === "skill" || context.session?.source === "extension") {
      return descriptorFromSnapshot(await this.readFile(context, path));
    }
    if (!snapshot) throw new Error(`File buffer is not attached: ${path}`);
    return descriptorFromSnapshot(snapshot);
  }

  async readFile(context: WorkspaceFileContext, path: string): Promise<FileSnapshot> {
    let resource: SkillFileSnapshotValue | ExtensionFileSnapshotValue | undefined;
    if (context.session?.source === "skill") {
      if (!this.#backend?.readSkillFile) throw new Error("The Skill file backend is unavailable");
      resource = await this.#backend.readSkillFile({
        ...resourceRequest(context.session),
        name: context.session.skillName,
        relativePath: workspaceRelativePath(context.rootPath, path),
      });
    } else if (context.session?.source === "extension") {
      if (!this.#backend?.readExtensionFile) {
        throw new Error("The extension file backend is unavailable");
      }
      resource = await this.#backend.readExtensionFile({
        ...resourceRequest(context.session),
        name: context.session.extensionName,
        filePath: context.session.extensionFilePath,
        source: context.session.extensionSource,
        scope: context.session.extensionScope,
        origin: context.session.extensionOrigin,
        relativePath: workspaceRelativePath(context.rootPath, path),
      });
    }
    if (resource) {
      const snapshot = resourceSnapshot(resource);
      this.storeSnapshot(context.scope, snapshot);
      return { ...snapshot };
    }
    if (context.workspaceId && this.#backend) {
      const remote = await this.#backend.readFile({
        workspaceId: context.workspaceId,
        relativePath: workspaceRelativePath(context.rootPath, path),
      });
      const snapshot = snapshotFromRemote(remote);
      this.storeSnapshot(context.scope, snapshot);
      return { ...snapshot };
    }

    const snapshot = this.getSnapshot(context, path);
    if (!snapshot) throw new Error(`File buffer is not attached: ${path}`);
    return { ...snapshot };
  }

  async writeFile(
    context: WorkspaceFileContext,
    path: string,
    content: string,
    version: string,
  ): Promise<FileSnapshot> {
    if (context.session?.source === "skill" || context.session?.source === "extension") {
      throw new Error("Resource files are read-only");
    }
    if (context.workspaceId && this.#backend) {
      const remote = await this.#backend.writeFile({
        workspaceId: context.workspaceId,
        relativePath: workspaceRelativePath(context.rootPath, path),
        content,
        expectedVersion: version,
      });
      const snapshot = snapshotFromRemote(remote);
      this.storeSnapshot(context.scope, snapshot);
      return { ...snapshot };
    }

    const absolutePath = workspaceAbsolutePath(context.rootPath, path);
    const current = this.getSnapshot(context, absolutePath);
    if (current && current.version !== version) {
      throw new Error(`File buffer changed since version ${version}`);
    }
    const snapshot: FileSnapshot = {
      path: absolutePath,
      source: "memory",
      name: current?.name ?? fileName(absolutePath),
      content,
      savedContent: content,
      version: nextVersion(),
      modifiedAt: Date.now(),
      size: new TextEncoder().encode(content).byteLength,
    };
    this.storeSnapshot(context.scope, snapshot);
    return { ...snapshot };
  }

  watchPath(context: WorkspaceFileContext, path: string, listener: () => void): Unsubscribe {
    const pathKey = normalizedPathKey(workspaceAbsolutePath(context.rootPath, path));
    const scopeKey = this.scopeKey(context.scope);
    const scopeListeners = this.#listeners.get(scopeKey) ?? new Map();
    const listeners = scopeListeners.get(pathKey) ?? new Set();
    listeners.add(listener);
    scopeListeners.set(pathKey, listeners);
    this.#listeners.set(scopeKey, scopeListeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) scopeListeners.delete(pathKey);
      if (scopeListeners.size === 0) this.#listeners.delete(scopeKey);
    };
  }

  async importFile(
    context: WorkspaceFileContext,
    file: File,
    rootPath = "",
  ): Promise<FileSnapshot> {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    const pathParts = (relativePath || file.name).split("/").filter(Boolean);
    const path = [rootPath.replace(/[\\/]$/, ""), ...pathParts].filter(Boolean).join("/");
    const absolutePath = workspaceAbsolutePath(context.rootPath, path);
    const content = await file.text();
    const snapshot: FileSnapshot = {
      path: absolutePath,
      source: "memory",
      name: file.name,
      content,
      savedContent: content,
      version: nextVersion(),
      modifiedAt: file.lastModified || Date.now(),
      size: file.size,
    };
    this.storeSnapshot(context.scope, snapshot);
    return { ...snapshot };
  }

  attachFile(context: WorkspaceFileContext, path: string, content: string): FileSnapshot {
    const absolutePath = workspaceAbsolutePath(context.rootPath, path);
    const current = this.getSnapshot(context, absolutePath);
    const snapshot: FileSnapshot = {
      path: absolutePath,
      ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
      ...(context.rootPath
        ? { relativePath: workspaceRelativePath(context.rootPath, absolutePath) }
        : {}),
      source:
        context.session?.source === "skill" || context.session?.source === "extension"
          ? "resource"
          : "memory",
      name: current?.name ?? fileName(absolutePath),
      content,
      savedContent: content,
      version: nextVersion(),
      modifiedAt: Date.now(),
      size: new TextEncoder().encode(content).byteLength,
    };
    this.storeSnapshot(context.scope, snapshot);
    return { ...snapshot };
  }

  updateBuffer(context: WorkspaceFileContext, path: string, content: string): void {
    const absolutePath = workspaceAbsolutePath(context.rootPath, path);
    const current = this.getSnapshot(context, absolutePath);
    if (!current) return;
    const snapshot = {
      ...current,
      content,
      modifiedAt: Date.now(),
      size: new TextEncoder().encode(content).byteLength,
    };
    this.storeSnapshot(context.scope, snapshot);
  }

  getSnapshot(context: WorkspaceFileContext, path: string): FileSnapshot | undefined {
    return this.#files
      .get(this.scopeKey(context.scope))
      ?.get(normalizedPathKey(workspaceAbsolutePath(context.rootPath, path)));
  }

  private scopeKey(scope: WorkspaceScope): string {
    return `${scope.type}:${scope.key}`;
  }

  private filesFor(scope: WorkspaceScope): Map<string, FileSnapshot> {
    const scopeKey = this.scopeKey(scope);
    const files = this.#files.get(scopeKey) ?? new Map();
    this.#files.set(scopeKey, files);
    return files;
  }

  private storeSnapshot(scope: WorkspaceScope, snapshot: FileSnapshot): void {
    this.filesFor(scope).set(normalizedPathKey(snapshot.path), snapshot);
    this.notify(scope, snapshot.path);
  }

  private notify(scope: WorkspaceScope, path: string): void {
    const pathKey = normalizedPathKey(path);
    const scopeListeners = this.#listeners.get(this.scopeKey(scope));
    for (const listener of scopeListeners?.get(pathKey) ?? []) listener();
    for (const [watchedPathKey, listeners] of scopeListeners ?? []) {
      if (watchedPathKey === pathKey || !isDescendantPath(watchedPathKey, pathKey)) continue;
      for (const listener of listeners) listener();
    }
  }
}

export class MemoryFileWorkspaceService extends BufferedFileWorkspaceService {}
