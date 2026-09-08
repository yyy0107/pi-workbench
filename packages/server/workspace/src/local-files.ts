import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  WorkbenchWorkspaceFileDescriptor,
  WorkbenchWorkspaceFileSnapshot,
  WorkbenchWorkspaceFilesListResult,
} from "@workbench/agent-runtime-contracts/runtime-capabilities";
import { WorkspaceFileError, WorkspaceFileService } from "./files";

type LocalFileDescriptor = Omit<WorkbenchWorkspaceFileDescriptor, "workspaceId" | "relativePath">;
type LocalFileSnapshot = Omit<WorkbenchWorkspaceFileSnapshot, "workspaceId" | "relativePath">;
type LocalFilesListResult = Omit<
  WorkbenchWorkspaceFilesListResult,
  "workspaceId" | "relativePath" | "entries"
> & {
  entries: Array<Omit<WorkbenchWorkspaceFilesListResult["entries"][number], "relativePath">>;
};

export interface LocalFileProtocol {
  listDirectory(path: string, signal?: AbortSignal): Promise<LocalFilesListResult>;
  describeFile(path: string, signal?: AbortSignal): Promise<LocalFileDescriptor>;
  readFile(path: string, signal?: AbortSignal): Promise<LocalFileSnapshot>;
  writeFile(
    path: string,
    content: string,
    expectedVersion: string,
    signal?: AbortSignal,
  ): Promise<LocalFileSnapshot>;
}

function withoutWorkspaceIdentity<T extends { workspaceId?: string; relativePath: string }>(
  value: T,
) {
  const { workspaceId: _workspaceId, relativePath: _relativePath, ...file } = value;
  return file;
}

/** Reuse the file IO, encoding, size limits, and version checks without registering a project. */
export class LocalFileService implements LocalFileProtocol {
  readonly #files = new WorkspaceFileService({
    resolveWorkspaceRoot: async (root) => (path.isAbsolute(root) ? root : undefined),
  });

  private async target(input: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const expanded = /^~[\\/]/.test(input) ? path.join(os.homedir(), input.slice(2)) : input;
    if (!path.isAbsolute(expanded) || expanded.includes("\0") || /^[\\/]{2}/.test(expanded)) {
      throw new WorkspaceFileError(
        "workspace-path-outside-root",
        "An absolute local file path is required.",
        { workspaceId: "local", relativePath: input },
      );
    }
    let canonicalPath: string;
    try {
      canonicalPath = await realpath(expanded);
    } catch {
      throw new WorkspaceFileError(
        "workspace-file-not-found",
        "The local file could not be found.",
        { workspaceId: "local", relativePath: input },
      );
    }
    signal?.throwIfAborted();
    return { workspaceId: path.dirname(canonicalPath), relativePath: path.basename(canonicalPath) };
  }

  async listDirectory(input: string, signal?: AbortSignal): Promise<LocalFilesListResult> {
    const target = await this.target(input, signal);
    const listing = withoutWorkspaceIdentity(await this.#files.listDirectory(target, signal));
    return { ...listing, entries: listing.entries.map(withoutWorkspaceIdentity) };
  }

  async describeFile(input: string, signal?: AbortSignal): Promise<LocalFileDescriptor> {
    return withoutWorkspaceIdentity(
      await this.#files.describeFile(await this.target(input, signal), signal),
    );
  }

  async readFile(input: string, signal?: AbortSignal): Promise<LocalFileSnapshot> {
    return withoutWorkspaceIdentity(
      await this.#files.readFile(await this.target(input, signal), signal),
    );
  }

  async writeFile(
    input: string,
    content: string,
    expectedVersion: string,
    signal?: AbortSignal,
  ): Promise<LocalFileSnapshot> {
    return withoutWorkspaceIdentity(
      await this.#files.writeFile(
        { ...(await this.target(input, signal)), content, expectedVersion },
        signal,
      ),
    );
  }

  async resolveFileContent(input: string, signal?: AbortSignal) {
    return this.#files.resolveFileContent(await this.target(input, signal), signal);
  }
}
