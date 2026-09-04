import { createHash } from "node:crypto";
import { open, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import mime from "mime";

import {
  WORKSPACE_FILE_EDITABLE_SIZE_LIMIT,
  WORKSPACE_FILE_RELATIVE_PATH_LENGTH_LIMIT,
  WORKSPACE_FILE_SEARCH_RESULT_LIMIT,
  type WorkbenchWorkspaceFileDescriptor as WorkspaceFileDescriptorValue,
  type WorkbenchWorkspaceFileEntry as WorkspaceFileEntry,
  type WorkbenchWorkspaceFileRequest as WorkspaceFileReadPayload,
  type WorkbenchWorkspaceFileSnapshot as WorkspaceFileSnapshotValue,
  type WorkbenchWorkspaceFilesListRequest as WorkspaceFilesListPayload,
  type WorkbenchWorkspaceFilesListResult as WorkspaceFilesListValue,
  type WorkbenchWorkspaceFilesSearchRequest as WorkspaceFilesSearchPayload,
  type WorkbenchWorkspaceFilesSearchResult as WorkspaceFilesSearchValue,
  type WorkbenchWorkspaceFileWriteRequest as WorkspaceFileWritePayload,
} from "@workbench/agent-runtime-contracts/runtime-capabilities";
import { RpcDomainError } from "@workbench/server-core/rpc-domain-error";

const DIRECTORY_ENTRY_LIMIT = 2_000;
const FILE_SEARCH_SCAN_LIMIT = 20_000;
const FILE_SEARCH_SKIPPED_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".mypy_cache",
  ".next",
  ".pnpm-store",
  ".pytest_cache",
  ".turbo",
  ".vercel",
  ".venv",
  ".yarn",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
  "venv",
]);
export const WORKSPACE_FILE_SIZE_LIMIT = WORKSPACE_FILE_EDITABLE_SIZE_LIMIT;
const ENCODING_SAMPLE_SIZE = 64 * 1024;
const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/;
const SOURCE_TEXT_EXTENSIONS = new Set([
  "bash",
  "c",
  "cc",
  "cjs",
  "cpp",
  "cs",
  "css",
  "diff",
  "go",
  "h",
  "hcl",
  "hpp",
  "html",
  "http",
  "ini",
  "java",
  "js",
  "json5",
  "jsonc",
  "jsx",
  "kt",
  "log",
  "mjs",
  "patch",
  "php",
  "proto",
  "py",
  "rb",
  "react",
  "rs",
  "sh",
  "sql",
  "swift",
  "tex",
  "toml",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
]);

export interface WorkspaceFileErrorDetails {
  "workspace-not-found": { workspaceId: string };
  "workspace-path-outside-root": { workspaceId: string; relativePath: string };
  "workspace-path-unreadable": { workspaceId: string; relativePath: string };
  "workspace-path-not-directory": { workspaceId: string; relativePath: string };
  "workspace-file-not-found": { workspaceId: string; relativePath: string };
  "workspace-file-not-regular": { workspaceId: string; relativePath: string };
  "workspace-file-too-large": {
    workspaceId: string;
    relativePath: string;
    limitBytes: number;
  };
  "workspace-file-unsupported-encoding": { workspaceId: string; relativePath: string };
  "workspace-file-conflict": { workspaceId: string; relativePath: string };
  "workspace-file-write-failed": { workspaceId: string; relativePath: string };
}

export type WorkspaceFileErrorCode = keyof WorkspaceFileErrorDetails;

export class WorkspaceFileError<
  Code extends WorkspaceFileErrorCode = WorkspaceFileErrorCode,
> extends RpcDomainError<Code, WorkspaceFileErrorDetails[Code]> {
  readonly code: Code;
  readonly details: WorkspaceFileErrorDetails[Code];

  constructor(code: Code, message: string, details: WorkspaceFileErrorDetails[Code]) {
    super(message);
    this.name = "WorkspaceFileError";
    this.code = code;
    this.details = details;
  }
}

export interface WorkspaceFileServiceOptions {
  resolveWorkspaceRoot: (workspaceId: string) => Promise<string | undefined>;
  fileSizeLimit?: number;
}

export interface WorkspaceFileProtocol {
  listDirectory(
    input: WorkspaceFilesListPayload,
    signal?: AbortSignal,
  ): Promise<WorkspaceFilesListValue>;
  searchFiles(
    input: WorkspaceFilesSearchPayload,
    signal?: AbortSignal,
  ): Promise<WorkspaceFilesSearchValue>;
  describeFile(
    input: WorkspaceFileReadPayload,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileDescriptorValue>;
  readFile(
    input: WorkspaceFileReadPayload,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileSnapshotValue>;
  writeFile(
    input: WorkspaceFileWritePayload,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileSnapshotValue>;
}

interface ResolvedWorkspacePath {
  workspaceId: string;
  relativePath: string;
  rootPath: string;
  absolutePath: string;
  canonicalPath: string;
}

export interface ResolvedWorkspaceFileContent extends WorkspaceFileDescriptorValue {
  canonicalPath: string;
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function isContainedPath(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`) && relative !== "..")
  );
}

function normalizeRelativePath(
  workspaceId: string,
  input: string | undefined,
  allowRoot: boolean,
): string {
  const relativePath = input ?? "";
  const invalid =
    relativePath.length > WORKSPACE_FILE_RELATIVE_PATH_LENGTH_LIMIT ||
    relativePath.includes("\0") ||
    path.isAbsolute(relativePath) ||
    WINDOWS_ABSOLUTE_PATH.test(relativePath) ||
    relativePath.includes("\\");
  const segments = relativePath.split("/");
  if (
    invalid ||
    (!allowRoot && relativePath === "") ||
    (segments.some((segment) => segment === "." || segment === ".." || segment === "") &&
      relativePath !== "")
  ) {
    throw new WorkspaceFileError(
      "workspace-path-outside-root",
      "The requested path is outside the workspace.",
      { workspaceId, relativePath },
    );
  }
  return segments.filter(Boolean).join("/");
}

function joinRelativePath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

function pathDetails(input: { workspaceId: string; relativePath: string }): {
  workspaceId: string;
  relativePath: string;
} {
  return { workspaceId: input.workspaceId, relativePath: input.relativePath };
}

function versionFor(content: Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("base64url")}`;
}

function versionForMetadata(size: number, modifiedAt: number): string {
  return `stat-sha256:${createHash("sha256").update(`${size}:${modifiedAt}`).digest("base64url")}`;
}

function mediaTypeForName(name: string): string {
  const extension = path.extname(name).slice(1).toLowerCase();
  if (SOURCE_TEXT_EXTENSIONS.has(extension)) return "text/plain";
  return mime.getType(name) ?? "application/octet-stream";
}

function isDefinitelyBinaryMediaType(mediaType: string): boolean {
  return (
    /^(?:image|audio|video|font)\//.test(mediaType) ||
    mediaType === "application/pdf" ||
    mediaType === "application/rtf" ||
    mediaType === "application/zip" ||
    mediaType === "application/gzip" ||
    mediaType === "application/wasm" ||
    mediaType.startsWith("application/vnd.") ||
    mediaType.startsWith("application/x-7z") ||
    mediaType.startsWith("application/x-rar")
  );
}

async function detectUtf8Encoding(
  canonicalPath: string,
  size: number,
  mediaType: string,
  signal?: AbortSignal,
): Promise<"utf-8" | null> {
  if (isDefinitelyBinaryMediaType(mediaType)) return null;

  const sampleSize = Math.min(size, ENCODING_SAMPLE_SIZE);
  if (sampleSize === 0) return "utf-8";
  const handle = await open(canonicalPath, "r");
  try {
    throwIfAborted(signal);
    const sample = Buffer.allocUnsafe(sampleSize);
    const { bytesRead } = await handle.read(sample, 0, sampleSize, 0);
    throwIfAborted(signal);
    const content = sample.subarray(0, bytesRead);
    if (content.includes(0)) return null;
    new TextDecoder("utf-8", { fatal: true }).decode(content, {
      stream: bytesRead < size,
    });
    return "utf-8";
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    return null;
  } finally {
    await handle.close();
  }
}

function decodeUtf8(
  content: Uint8Array,
  input: { workspaceId: string; relativePath: string },
): string {
  if (content.includes(0)) {
    throw new WorkspaceFileError(
      "workspace-file-unsupported-encoding",
      "The file is not supported as UTF-8 text.",
      pathDetails(input),
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new WorkspaceFileError(
      "workspace-file-unsupported-encoding",
      "The file is not supported as UTF-8 text.",
      pathDetails(input),
    );
  }
}

function compareEntries(left: WorkspaceFileEntry, right: WorkspaceFileEntry): number {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
  return left.name.localeCompare(right.name, "en-US", { numeric: true, sensitivity: "base" });
}

export class WorkspaceFileService implements WorkspaceFileProtocol {
  readonly #resolveWorkspaceRoot: WorkspaceFileServiceOptions["resolveWorkspaceRoot"];
  readonly #fileSizeLimit: number;
  readonly #writeTails = new Map<string, Promise<void>>();

  constructor(options: WorkspaceFileServiceOptions) {
    this.#resolveWorkspaceRoot = options.resolveWorkspaceRoot;
    this.#fileSizeLimit = options.fileSizeLimit ?? WORKSPACE_FILE_SIZE_LIMIT;
  }

  async listDirectory(
    input: WorkspaceFilesListPayload,
    signal?: AbortSignal,
  ): Promise<WorkspaceFilesListValue> {
    const relativePath = normalizeRelativePath(input.workspaceId, input.relativePath, true);
    const resolved = await this.resolvePath(input.workspaceId, relativePath, signal, "directory");

    let children;
    try {
      throwIfAborted(signal);
      children = await readdir(resolved.canonicalPath, { withFileTypes: true });
      throwIfAborted(signal);
    } catch (error) {
      if (error instanceof WorkspaceFileError || isAbortError(error, signal)) throw error;
      throw new WorkspaceFileError(
        "workspace-path-unreadable",
        "The workspace directory could not be read.",
        pathDetails(resolved),
      );
    }

    const entries: WorkspaceFileEntry[] = [];
    for (const child of children) {
      throwIfAborted(signal);
      if (entries.length > DIRECTORY_ENTRY_LIMIT) break;
      const childRelativePath = joinRelativePath(relativePath, child.name);
      const childAbsolutePath = path.join(resolved.absolutePath, child.name);
      let kind: WorkspaceFileEntry["kind"] | undefined;
      let symbolicLink = false;

      if (child.isDirectory()) kind = "directory";
      else if (child.isFile()) kind = "file";
      else if (child.isSymbolicLink()) {
        symbolicLink = true;
        try {
          const canonicalChild = await realpath(childAbsolutePath);
          if (!isContainedPath(resolved.rootPath, canonicalChild)) continue;
          const childStat = await stat(canonicalChild);
          if (childStat.isDirectory()) kind = "directory";
          else if (childStat.isFile()) kind = "file";
        } catch (error) {
          if (isAbortError(error, signal)) throw error;
          continue;
        }
      }

      if (!kind) continue;
      entries.push({
        name: child.name,
        relativePath: childRelativePath,
        absolutePath: childAbsolutePath,
        kind,
        hidden: child.name.startsWith("."),
        ...(symbolicLink ? { symbolicLink: true } : {}),
      });
    }

    entries.sort(compareEntries);
    return {
      workspaceId: input.workspaceId,
      relativePath,
      absolutePath: resolved.absolutePath,
      entries: entries.slice(0, DIRECTORY_ENTRY_LIMIT),
      truncated: entries.length > DIRECTORY_ENTRY_LIMIT,
    };
  }

  async searchFiles(
    input: WorkspaceFilesSearchPayload,
    signal?: AbortSignal,
  ): Promise<WorkspaceFilesSearchValue> {
    const rootPath = await this.workspaceRoot(input.workspaceId, signal);
    const query = input.query.trim().toLocaleLowerCase("en-US");
    const limit = Math.max(1, Math.min(input.limit ?? 50, WORKSPACE_FILE_SEARCH_RESULT_LIMIT));
    const directories: Array<{ absolutePath: string; relativePath: string }> = [
      { absolutePath: rootPath, relativePath: "" },
    ];
    const visitedDirectories = new Set([rootPath]);
    const entries: WorkspaceFileEntry[] = [];
    let scannedEntries = 0;
    let truncated = false;

    while (directories.length > 0 && entries.length <= limit) {
      throwIfAborted(signal);
      const directory = directories.shift()!;
      let children;
      try {
        children = await readdir(directory.absolutePath, { withFileTypes: true });
      } catch (error) {
        if (isAbortError(error, signal)) throw error;
        if (directory.relativePath === "") {
          throw new WorkspaceFileError(
            "workspace-path-unreadable",
            "The workspace directory could not be searched.",
            { workspaceId: input.workspaceId, relativePath: "" },
          );
        }
        continue;
      }
      children.sort((left, right) =>
        left.name.localeCompare(right.name, "en-US", { numeric: true, sensitivity: "base" }),
      );

      for (const child of children) {
        throwIfAborted(signal);
        scannedEntries += 1;
        if (scannedEntries > FILE_SEARCH_SCAN_LIMIT) {
          truncated = true;
          break;
        }

        const relativePath = joinRelativePath(directory.relativePath, child.name);
        const absolutePath = path.join(directory.absolutePath, child.name);
        let kind: WorkspaceFileEntry["kind"] | undefined;
        let symbolicLink = false;
        let canonicalPath = absolutePath;

        if (child.isDirectory()) kind = "directory";
        else if (child.isFile()) kind = "file";
        else if (child.isSymbolicLink()) {
          symbolicLink = true;
          try {
            canonicalPath = await realpath(absolutePath);
            if (!isContainedPath(rootPath, canonicalPath)) continue;
            const childStat = await stat(canonicalPath);
            if (childStat.isDirectory()) kind = "directory";
            else if (childStat.isFile()) kind = "file";
          } catch (error) {
            if (isAbortError(error, signal)) throw error;
            continue;
          }
        }

        if (kind === "directory") {
          if (
            FILE_SEARCH_SKIPPED_DIRECTORIES.has(child.name) ||
            visitedDirectories.has(canonicalPath)
          ) {
            continue;
          }
          visitedDirectories.add(canonicalPath);
          directories.push({ absolutePath: canonicalPath, relativePath });
          continue;
        }
        if (kind !== "file") continue;
        if (query && !relativePath.toLocaleLowerCase("en-US").includes(query)) continue;

        entries.push({
          name: child.name,
          relativePath,
          absolutePath,
          kind,
          hidden: child.name.startsWith("."),
          ...(symbolicLink ? { symbolicLink: true } : {}),
        });
        if (entries.length > limit) {
          truncated = true;
          break;
        }
      }

      if (scannedEntries > FILE_SEARCH_SCAN_LIMIT) break;
    }

    if (directories.length > 0 && entries.length >= limit) truncated = true;
    return {
      workspaceId: input.workspaceId,
      query: input.query.trim(),
      entries: entries.slice(0, limit),
      truncated,
    };
  }

  async readFile(
    input: WorkspaceFileReadPayload,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileSnapshotValue> {
    const relativePath = normalizeRelativePath(input.workspaceId, input.relativePath, false);
    const resolved = await this.resolvePath(input.workspaceId, relativePath, signal, "file");
    return this.readResolvedFile(resolved, signal);
  }

  async describeFile(
    input: WorkspaceFileReadPayload,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileDescriptorValue> {
    const relativePath = normalizeRelativePath(input.workspaceId, input.relativePath, false);
    const resolved = await this.resolvePath(input.workspaceId, relativePath, signal, "file");
    return this.describeResolvedFile(resolved, signal);
  }

  async resolveFileContent(
    input: WorkspaceFileReadPayload,
    signal?: AbortSignal,
  ): Promise<ResolvedWorkspaceFileContent> {
    const relativePath = normalizeRelativePath(input.workspaceId, input.relativePath, false);
    const resolved = await this.resolvePath(input.workspaceId, relativePath, signal, "file");
    const descriptor = await this.describeResolvedFile(resolved, signal);
    return { ...descriptor, canonicalPath: resolved.canonicalPath };
  }

  async writeFile(
    input: WorkspaceFileWritePayload,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileSnapshotValue> {
    const relativePath = normalizeRelativePath(input.workspaceId, input.relativePath, false);
    const byteLength = Buffer.byteLength(input.content, "utf8");
    if (byteLength > this.#fileSizeLimit) {
      throw new WorkspaceFileError(
        "workspace-file-too-large",
        "The file exceeds the editable size limit.",
        {
          workspaceId: input.workspaceId,
          relativePath,
          limitBytes: this.#fileSizeLimit,
        },
      );
    }

    return this.serializeWrite(`${input.workspaceId}:${relativePath}`, async () => {
      const resolved = await this.resolvePath(input.workspaceId, relativePath, signal, "file");
      const current = await this.readResolvedFile(resolved, signal);
      if (current.version !== input.expectedVersion) {
        throw new WorkspaceFileError(
          "workspace-file-conflict",
          "The file changed since it was opened.",
          pathDetails(resolved),
        );
      }

      try {
        throwIfAborted(signal);
        await writeFile(resolved.canonicalPath, input.content, { encoding: "utf8", signal });
        throwIfAborted(signal);
      } catch (error) {
        if (error instanceof WorkspaceFileError || isAbortError(error, signal)) throw error;
        throw new WorkspaceFileError(
          "workspace-file-write-failed",
          "The workspace file could not be written.",
          pathDetails(resolved),
        );
      }
      return this.readResolvedFile(resolved, signal);
    });
  }

  private async workspaceRoot(workspaceId: string, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const workspacePath = await this.#resolveWorkspaceRoot(workspaceId);
    if (!workspacePath) {
      throw new WorkspaceFileError("workspace-not-found", "The workspace does not exist.", {
        workspaceId,
      });
    }

    try {
      const rootPath = await realpath(workspacePath);
      throwIfAborted(signal);
      if (!(await stat(rootPath)).isDirectory())
        throw new Error("Workspace root is not a directory");
      return rootPath;
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      throw new WorkspaceFileError(
        "workspace-path-unreadable",
        "The workspace root could not be read.",
        { workspaceId, relativePath: "" },
      );
    }
  }

  private async resolvePath(
    workspaceId: string,
    relativePath: string,
    signal: AbortSignal | undefined,
    expectedKind: "file" | "directory",
  ): Promise<ResolvedWorkspacePath> {
    const rootPath = await this.workspaceRoot(workspaceId, signal);
    const absolutePath = path.join(rootPath, ...relativePath.split("/").filter(Boolean));
    if (!isContainedPath(rootPath, absolutePath)) {
      throw new WorkspaceFileError(
        "workspace-path-outside-root",
        "The requested path is outside the workspace.",
        { workspaceId, relativePath },
      );
    }

    let canonicalPath: string;
    let targetStat;
    try {
      throwIfAborted(signal);
      canonicalPath = await realpath(absolutePath);
      throwIfAborted(signal);
      if (!isContainedPath(rootPath, canonicalPath)) {
        throw new WorkspaceFileError(
          "workspace-path-outside-root",
          "The requested path is outside the workspace.",
          { workspaceId, relativePath },
        );
      }
      targetStat = await stat(canonicalPath);
      throwIfAborted(signal);
    } catch (error) {
      if (error instanceof WorkspaceFileError || isAbortError(error, signal)) throw error;
      const missing = errorCode(error) === "ENOENT";
      if (expectedKind === "file" && missing) {
        throw new WorkspaceFileError(
          "workspace-file-not-found",
          "The workspace file does not exist.",
          { workspaceId, relativePath },
        );
      }
      throw new WorkspaceFileError(
        "workspace-path-unreadable",
        "The workspace path could not be read.",
        { workspaceId, relativePath },
      );
    }

    if (expectedKind === "directory" && !targetStat.isDirectory()) {
      throw new WorkspaceFileError(
        "workspace-path-not-directory",
        "The workspace path is not a directory.",
        { workspaceId, relativePath },
      );
    }
    if (expectedKind === "file" && !targetStat.isFile()) {
      throw new WorkspaceFileError(
        "workspace-file-not-regular",
        "The workspace path is not a regular file.",
        { workspaceId, relativePath },
      );
    }

    return { workspaceId, relativePath, rootPath, absolutePath, canonicalPath };
  }

  private async readResolvedFile(
    resolved: ResolvedWorkspacePath,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileSnapshotValue> {
    let metadata;
    let content: Uint8Array;
    try {
      throwIfAborted(signal);
      metadata = await stat(resolved.canonicalPath);
      if (!metadata.isFile()) {
        throw new WorkspaceFileError(
          "workspace-file-not-regular",
          "The workspace path is not a regular file.",
          pathDetails(resolved),
        );
      }
      if (metadata.size > this.#fileSizeLimit) {
        throw new WorkspaceFileError(
          "workspace-file-too-large",
          "The file exceeds the editable size limit.",
          { ...pathDetails(resolved), limitBytes: this.#fileSizeLimit },
        );
      }
      content = await readFile(resolved.canonicalPath, { signal });
      throwIfAborted(signal);
      if (content.byteLength > this.#fileSizeLimit) {
        throw new WorkspaceFileError(
          "workspace-file-too-large",
          "The file exceeds the editable size limit.",
          { ...pathDetails(resolved), limitBytes: this.#fileSizeLimit },
        );
      }
    } catch (error) {
      if (error instanceof WorkspaceFileError || isAbortError(error, signal)) throw error;
      throw new WorkspaceFileError(
        "workspace-path-unreadable",
        "The workspace file could not be read.",
        pathDetails(resolved),
      );
    }

    return {
      workspaceId: resolved.workspaceId,
      relativePath: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      name: path.basename(resolved.absolutePath),
      content: decodeUtf8(content, resolved),
      encoding: "utf-8",
      version: versionFor(content),
      size: content.byteLength,
      modifiedAt: metadata.mtimeMs,
    };
  }

  private async describeResolvedFile(
    resolved: ResolvedWorkspacePath,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileDescriptorValue> {
    try {
      throwIfAborted(signal);
      const metadata = await stat(resolved.canonicalPath);
      if (!metadata.isFile()) {
        throw new WorkspaceFileError(
          "workspace-file-not-regular",
          "The workspace path is not a regular file.",
          pathDetails(resolved),
        );
      }
      const name = path.basename(resolved.absolutePath);
      const mediaType = mediaTypeForName(name);
      const encoding = await detectUtf8Encoding(
        resolved.canonicalPath,
        metadata.size,
        mediaType,
        signal,
      );
      throwIfAborted(signal);
      return {
        workspaceId: resolved.workspaceId,
        relativePath: resolved.relativePath,
        absolutePath: resolved.absolutePath,
        name,
        mediaType,
        encoding,
        version: versionForMetadata(metadata.size, metadata.mtimeMs),
        size: metadata.size,
        modifiedAt: metadata.mtimeMs,
      };
    } catch (error) {
      if (error instanceof WorkspaceFileError || isAbortError(error, signal)) throw error;
      throw new WorkspaceFileError(
        "workspace-path-unreadable",
        "The workspace file could not be inspected.",
        pathDetails(resolved),
      );
    }
  }

  private async serializeWrite<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#writeTails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => next);
    this.#writeTails.set(key, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.#writeTails.get(key) === tail) this.#writeTails.delete(key);
    }
  }
}

export function createWorkspaceFileService(
  options: WorkspaceFileServiceOptions,
): WorkspaceFileService {
  return new WorkspaceFileService(options);
}
