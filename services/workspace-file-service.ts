import type { WorkspaceContext, WorkspaceScope } from "@/platform/extensions";
import {
  describePiWorkspaceFile,
  listPiWorkspaceFiles,
  piWorkspaceFileContentUrl,
  readPiWorkspaceFile,
  writePiWorkspaceFile,
} from "@/runtime/pi/client/transport/api";
import type {
  WorkspaceFileDescribePayload,
  WorkspaceFileDescriptorValue,
  WorkspaceFileReadPayload,
  WorkspaceFileSnapshotValue,
  WorkspaceFilesListPayload,
  WorkspaceFilesListValue,
  WorkspaceFileWritePayload,
} from "@/runtime/pi/rpc-contracts";

export interface WorkspaceFileContext {
  scope: WorkspaceScope;
  workspaceId?: string;
  rootPath?: string;
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
  source: "memory" | "workspace";
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
  source: "memory" | "workspace";
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
  listDirectory(payload: WorkspaceFilesListPayload): Promise<WorkspaceFilesListValue>;
  describeFile(payload: WorkspaceFileDescribePayload): Promise<WorkspaceFileDescriptorValue>;
  readFile(payload: WorkspaceFileReadPayload): Promise<WorkspaceFileSnapshotValue>;
  writeFile(payload: WorkspaceFileWritePayload): Promise<WorkspaceFileSnapshotValue>;
}

/**
 * Shared file capability used by file-oriented contributions.
 *
 * `scope` isolates browser buffers between Workbench contexts. `workspaceId` is the server-side
 * authority used for real filesystem access; it must never be inferred from the scope key.
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

function workspaceAbsolutePath(rootPath: string | undefined, path: string): string {
  if (isAbsoluteWorkspacePath(path) || !rootPath) return path;
  const relativePath = normalizeRelativePath(path);
  const separator = rootPath.includes("\\") && !rootPath.includes("/") ? "\\" : "/";
  const root = rootPath.replace(/[\\/]+$/, "");
  return relativePath ? `${root}${separator}${relativePath.replaceAll("/", separator)}` : rootPath;
}

export function fileWorkspaceContext(
  scope: WorkspaceScope,
  context?: Pick<WorkspaceContext, "worktreeId" | "projectId" | "rootPath">,
): WorkspaceFileContext {
  const workspaceId = context?.worktreeId ?? context?.projectId;
  return {
    scope,
    ...(workspaceId ? { workspaceId } : {}),
    ...(context?.rootPath ? { rootPath: context.rootPath } : {}),
  };
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

function descriptorFromRemote(value: WorkspaceFileDescriptorValue): FileDescriptor {
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
    contentUrl: piWorkspaceFileContentUrl({
      workspaceId: value.workspaceId,
      relativePath: value.relativePath,
    }),
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

export class BufferedFileWorkspaceService implements FileWorkspaceService {
  readonly #files = new Map<string, Map<string, FileSnapshot>>();
  readonly #listeners = new Map<string, Map<string, Set<() => void>>>();
  readonly #backend?: FileWorkspaceBackend;

  constructor(backend?: FileWorkspaceBackend) {
    this.#backend = backend;
  }

  async listDirectory(context: WorkspaceFileContext, path: string): Promise<FileDirectoryListing> {
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
      return descriptorFromRemote(descriptor);
    }
    if (!snapshot) throw new Error(`File buffer is not attached: ${path}`);
    return descriptorFromSnapshot(snapshot);
  }

  async readFile(context: WorkspaceFileContext, path: string): Promise<FileSnapshot> {
    if (context.workspaceId && this.#backend) {
      const remote = await this.#backend.readFile({
        workspaceId: context.workspaceId,
        relativePath: workspaceRelativePath(context.rootPath, path),
      });
      const snapshot = snapshotFromRemote(remote);
      this.filesFor(context.scope).set(snapshot.path, snapshot);
      this.notify(context.scope, snapshot.path);
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
    if (context.workspaceId && this.#backend) {
      const remote = await this.#backend.writeFile({
        workspaceId: context.workspaceId,
        relativePath: workspaceRelativePath(context.rootPath, path),
        content,
        expectedVersion: version,
      });
      const snapshot = snapshotFromRemote(remote);
      this.filesFor(context.scope).set(snapshot.path, snapshot);
      this.notify(context.scope, snapshot.path);
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
    this.filesFor(context.scope).set(absolutePath, snapshot);
    this.notify(context.scope, absolutePath);
    return { ...snapshot };
  }

  watchPath(context: WorkspaceFileContext, path: string, listener: () => void): Unsubscribe {
    const absolutePath = workspaceAbsolutePath(context.rootPath, path);
    const scopeKey = this.scopeKey(context.scope);
    const scopeListeners = this.#listeners.get(scopeKey) ?? new Map();
    const listeners = scopeListeners.get(absolutePath) ?? new Set();
    listeners.add(listener);
    scopeListeners.set(absolutePath, listeners);
    this.#listeners.set(scopeKey, scopeListeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) scopeListeners.delete(absolutePath);
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
    const content = await file.text();
    const snapshot: FileSnapshot = {
      path,
      source: "memory",
      name: file.name,
      content,
      savedContent: content,
      version: nextVersion(),
      modifiedAt: file.lastModified || Date.now(),
      size: file.size,
    };
    this.filesFor(context.scope).set(path, snapshot);
    this.notify(context.scope, path);
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
      source: "memory",
      name: current?.name ?? fileName(absolutePath),
      content,
      savedContent: content,
      version: nextVersion(),
      modifiedAt: Date.now(),
      size: new TextEncoder().encode(content).byteLength,
    };
    this.filesFor(context.scope).set(absolutePath, snapshot);
    this.notify(context.scope, absolutePath);
    return { ...snapshot };
  }

  updateBuffer(context: WorkspaceFileContext, path: string, content: string): void {
    const absolutePath = workspaceAbsolutePath(context.rootPath, path);
    const current = this.getSnapshot(context, absolutePath);
    if (!current) return;
    this.filesFor(context.scope).set(absolutePath, {
      ...current,
      content,
      modifiedAt: Date.now(),
      size: new TextEncoder().encode(content).byteLength,
    });
    this.notify(context.scope, absolutePath);
  }

  getSnapshot(context: WorkspaceFileContext, path: string): FileSnapshot | undefined {
    return this.#files
      .get(this.scopeKey(context.scope))
      ?.get(workspaceAbsolutePath(context.rootPath, path));
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

  private notify(scope: WorkspaceScope, path: string): void {
    const scopeListeners = this.#listeners.get(this.scopeKey(scope));
    for (const listener of scopeListeners?.get(path) ?? []) listener();
    for (const [watchedPath, listeners] of scopeListeners ?? []) {
      if (watchedPath === path || !path.startsWith(`${watchedPath}/`)) continue;
      for (const listener of listeners) listener();
    }
  }
}

export class MemoryFileWorkspaceService extends BufferedFileWorkspaceService {}

const piWorkspaceFileBackend: FileWorkspaceBackend = {
  listDirectory: listPiWorkspaceFiles,
  describeFile: describePiWorkspaceFile,
  readFile: readPiWorkspaceFile,
  writeFile: writePiWorkspaceFile,
};

export const fileWorkspaceService = new BufferedFileWorkspaceService(piWorkspaceFileBackend);
