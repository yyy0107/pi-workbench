export interface FileNode {
  path: string;
  name: string;
  kind: "file" | "directory";
}

export interface FileSnapshot {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  version: string;
  modifiedAt: number;
}

export type Unsubscribe = () => void;

export interface FileWorkspaceService {
  listDirectory(path: string): Promise<FileNode[]>;
  readFile(path: string): Promise<FileSnapshot>;
  writeFile(path: string, content: string, version: string): Promise<FileSnapshot>;
  watchPath(path: string, listener: () => void): Unsubscribe;
  importFile(file: File, rootPath?: string): Promise<FileSnapshot>;
  attachFile(path: string, content: string): FileSnapshot;
  updateBuffer(path: string, content: string): void;
  getSnapshot(path: string): FileSnapshot | undefined;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function nextVersion(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class MemoryFileWorkspaceService implements FileWorkspaceService {
  readonly #files = new Map<string, FileSnapshot>();
  readonly #listeners = new Map<string, Set<() => void>>();

  async listDirectory(path: string): Promise<FileNode[]> {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    return [...this.#files.values()]
      .filter((file) => file.path === path || file.path.startsWith(prefix))
      .map((file) => ({ path: file.path, name: file.name, kind: "file" as const }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  async readFile(path: string): Promise<FileSnapshot> {
    const snapshot = this.#files.get(path);
    if (!snapshot) throw new Error(`File buffer is not attached: ${path}`);
    return { ...snapshot };
  }

  async writeFile(path: string, content: string, version: string): Promise<FileSnapshot> {
    const current = this.#files.get(path);
    if (current && current.version !== version) {
      throw new Error(`File buffer changed since version ${version}`);
    }
    const snapshot: FileSnapshot = {
      path,
      name: current?.name ?? fileName(path),
      content,
      savedContent: content,
      version: nextVersion(),
      modifiedAt: Date.now(),
    };
    this.#files.set(path, snapshot);
    this.notify(path);
    return { ...snapshot };
  }

  watchPath(path: string, listener: () => void): Unsubscribe {
    const listeners = this.#listeners.get(path) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(path, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(path);
    };
  }

  async importFile(file: File, rootPath = ""): Promise<FileSnapshot> {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    const pathParts = (relativePath || file.name).split("/").filter(Boolean);
    const path = [rootPath.replace(/[\\/]$/, ""), ...pathParts].filter(Boolean).join("/");
    const content = await file.text();
    const snapshot: FileSnapshot = {
      path,
      name: file.name,
      content,
      savedContent: content,
      version: nextVersion(),
      modifiedAt: file.lastModified || Date.now(),
    };
    this.#files.set(path, snapshot);
    this.notify(path);
    return { ...snapshot };
  }

  attachFile(path: string, content: string): FileSnapshot {
    const current = this.#files.get(path);
    const snapshot: FileSnapshot = {
      path,
      name: current?.name ?? fileName(path),
      content,
      savedContent: content,
      version: nextVersion(),
      modifiedAt: Date.now(),
    };
    this.#files.set(path, snapshot);
    this.notify(path);
    return { ...snapshot };
  }

  updateBuffer(path: string, content: string): void {
    const current = this.#files.get(path);
    if (!current) return;
    this.#files.set(path, { ...current, content, modifiedAt: Date.now() });
    this.notify(path);
  }

  getSnapshot(path: string): FileSnapshot | undefined {
    return this.#files.get(path);
  }

  private notify(path: string): void {
    for (const listener of this.#listeners.get(path) ?? []) listener();
    for (const [watchedPath, listeners] of this.#listeners) {
      if (watchedPath === path || !path.startsWith(`${watchedPath}/`)) continue;
      for (const listener of listeners) listener();
    }
  }
}

export const fileWorkspaceService = new MemoryFileWorkspaceService();
