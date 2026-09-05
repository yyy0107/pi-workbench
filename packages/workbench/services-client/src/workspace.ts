import type { WorkbenchServicesCapabilities } from "@workbench/agent-runtime-client/capabilities";
import type {
  WorkbenchWorkspaceGitRequest as WorkspaceGitDescribePayload,
  WorkbenchWorkspaceGitBranchRequest as WorkspaceGitCreateBranchPayload,
  WorkbenchWorkspaceGitBranchRequest as WorkspaceGitSwitchBranchPayload,
  WorkbenchWorkspaceGitLog as WorkspaceGitLogValue,
  WorkbenchWorkspaceGitLogRequest,
  WorkbenchWorkspaceFilesListRequest as WorkspaceFilesListPayload,
  WorkbenchWorkspaceFilesListResult as WorkspaceFilesListValue,
  WorkbenchWorkspaceFilesSearchRequest as WorkspaceFilesSearchPayload,
  WorkbenchWorkspaceFilesSearchResult as WorkspaceFilesSearchValue,
  WorkbenchWorkspaceFileRequest as WorkspaceFileReadPayload,
  WorkbenchWorkspaceFileRequest as WorkspaceFileDescribePayload,
  WorkbenchWorkspaceFileDescriptor as WorkspaceFileDescriptorValue,
  WorkbenchWorkspaceFileSnapshot as WorkspaceFileSnapshotValue,
  WorkbenchWorkspaceFileWriteRequest as WorkspaceFileWritePayload,
  WorkbenchWorkspaceGitStatus as WorkspaceGitStatus,
} from "@workbench/agent-runtime-contracts/runtime-capabilities";
import { callServiceRpc, capabilityCall } from "./errors";
import {
  RpcClientError,
  resolveRuntimeFetch,
  type RpcCallOptions,
} from "@workbench/host-client/rpc";
import type { RuntimeFetch } from "@workbench/host-client";

export function listWorkspaceFiles(
  payload: WorkspaceFilesListPayload,
  options?: RpcCallOptions,
): Promise<WorkspaceFilesListValue> {
  return callServiceRpc("workspace.files.list", payload, options);
}

export function searchWorkspaceFiles(
  payload: WorkspaceFilesSearchPayload,
  options?: RpcCallOptions,
): Promise<WorkspaceFilesSearchValue> {
  return callServiceRpc("workspace.files.search", payload, options);
}

export function describeWorkspaceFile(
  payload: WorkspaceFileDescribePayload,
  options?: RpcCallOptions,
): Promise<WorkspaceFileDescriptorValue> {
  return callServiceRpc("workspace.files.describe", payload, options);
}

export function workspaceFileContentUrl(payload: WorkspaceFileDescribePayload): string {
  const query = new URLSearchParams({
    workspaceId: payload.workspaceId,
    relativePath: payload.relativePath,
  });
  return `/api/workspace.files.content?${query.toString()}`;
}

/**
 * Read a binary preview through the installation-bound HTTP carrier. Desktop sidecars cannot use
 * a bare `<img src="/api/...">` because that request cannot carry the in-memory Bearer token.
 */
export async function fetchWorkspaceFileContent(
  payload: WorkspaceFileDescribePayload,
  options?: RpcCallOptions,
): Promise<Blob> {
  const response = await resolveRuntimeFetch(options?.transport)(workspaceFileContentUrl(payload), {
    headers: { Accept: "*/*" },
    signal: options?.signal,
  });
  if (!response.ok) throw new RpcClientError("workspace_file_content_failed", response.status);
  return response.blob();
}

export interface WorkspaceFileTextChunk {
  text: string;
  loadedBytes: number;
  totalBytes?: number;
}

export interface StreamWorkspaceFileTextOptions {
  signal?: AbortSignal;
  onChunk(chunk: WorkspaceFileTextChunk): void;
  /** Directs this file-content request to one explicit Runtime Host. */
  transport?: RuntimeFetch;
}

function contentLength(response: Response): number | undefined {
  const header = response.headers.get("content-length");
  if (header === null) return undefined;
  const value = Number(header);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function decodeWorkspaceFileText(decoder: TextDecoder, value?: Uint8Array, stream = false): string {
  try {
    return value ? decoder.decode(value, { stream }) : decoder.decode();
  } catch {
    throw new RpcClientError("workspace-file-unsupported-encoding", 422);
  }
}

export async function streamWorkspaceFileText(
  payload: WorkspaceFileDescribePayload,
  { signal, onChunk, transport }: StreamWorkspaceFileTextOptions,
): Promise<{ loadedBytes: number; totalBytes?: number }> {
  const response = await resolveRuntimeFetch(transport)(workspaceFileContentUrl(payload), {
    headers: { Accept: "text/plain, text/*;q=0.9, application/json;q=0.8, */*;q=0.1" },
    signal,
  });
  if (!response.ok) {
    throw new RpcClientError("workspace_file_content_failed", response.status);
  }

  const totalBytes = contentLength(response);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const reader = response.body?.getReader();
  if (!reader) throw new RpcClientError("workspace_file_content_unavailable", response.status);

  let loadedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (value.includes(0)) {
        throw new RpcClientError("workspace-file-unsupported-encoding", 422);
      }
      loadedBytes += value.byteLength;
      const text = decodeWorkspaceFileText(decoder, value, true);
      onChunk({ text, loadedBytes, ...(totalBytes === undefined ? {} : { totalBytes }) });
    }
    const text = decodeWorkspaceFileText(decoder);
    if (text) {
      onChunk({ text, loadedBytes, ...(totalBytes === undefined ? {} : { totalBytes }) });
    }
  } catch (error) {
    if (error instanceof RpcClientError || signal?.aborted) throw error;
    throw new RpcClientError("workspace_file_content_failed", response.status);
  } finally {
    reader.releaseLock();
  }

  return { loadedBytes, ...(totalBytes === undefined ? {} : { totalBytes }) };
}

export function readWorkspaceFile(
  payload: WorkspaceFileReadPayload,
  options?: RpcCallOptions,
): Promise<WorkspaceFileSnapshotValue> {
  return callServiceRpc("workspace.files.read", payload, options);
}

export function writeWorkspaceFile(
  payload: WorkspaceFileWritePayload,
  options?: RpcCallOptions,
): Promise<WorkspaceFileSnapshotValue> {
  return callServiceRpc("workspace.files.write", payload, options);
}

export function describeWorkspaceGit(
  payload: WorkspaceGitDescribePayload,
  options?: RpcCallOptions,
): Promise<WorkspaceGitStatus> {
  return callServiceRpc("workspace.git.describe", payload, options);
}

export function readWorkspaceGitLog(
  payload: WorkbenchWorkspaceGitLogRequest,
  options?: RpcCallOptions,
): Promise<WorkspaceGitLogValue> {
  return callServiceRpc("workspace.git.log", payload, options);
}

export function switchWorkspaceGitBranch(
  payload: WorkspaceGitSwitchBranchPayload,
  options?: RpcCallOptions,
): Promise<WorkspaceGitStatus> {
  return callServiceRpc("workspace.git.switchBranch", payload, options);
}

export function createWorkspaceGitBranch(
  payload: WorkspaceGitCreateBranchPayload,
  options?: RpcCallOptions,
): Promise<WorkspaceGitStatus> {
  return callServiceRpc("workspace.git.createBranch", payload, options);
}

export function createWorkspaceClient(
  rpcOptions: Readonly<RpcCallOptions> = {},
): WorkbenchServicesCapabilities["workspace"] {
  const options = Object.freeze({ ...rpcOptions });
  return Object.freeze({
    listFiles: (request) => capabilityCall(() => listWorkspaceFiles(request, options)),
    searchFiles: (request, requestOptions) =>
      capabilityCall(() => searchWorkspaceFiles(request, { ...options, ...requestOptions })),
    describeFile: (request) => capabilityCall(() => describeWorkspaceFile(request, options)),
    fileContentUrl: workspaceFileContentUrl,
    fetchFileContent: (request, requestOptions) =>
      capabilityCall(() => fetchWorkspaceFileContent(request, { ...options, ...requestOptions })),
    readFile: (request) => capabilityCall(() => readWorkspaceFile(request, options)),
    writeFile: (request) => capabilityCall(() => writeWorkspaceFile(request, options)),
    streamFileText: (request, streamOptions) =>
      capabilityCall(() =>
        streamWorkspaceFileText(request, {
          ...streamOptions,
          transport: options.transport,
        }),
      ),
    describeGit: (workspaceId, requestOptions) =>
      capabilityCall(() =>
        describeWorkspaceGit({ workspaceId }, { ...options, ...requestOptions }),
      ),
    readGitLog: (workspaceId, requestOptions) =>
      capabilityCall(() =>
        readWorkspaceGitLog(
          { workspaceId, offset: requestOptions?.offset },
          { ...options, ...requestOptions },
        ),
      ),
    switchGitBranch: (workspaceId, branch) =>
      capabilityCall(() => switchWorkspaceGitBranch({ workspaceId, branch }, options)),
    createGitBranch: (workspaceId, branch) =>
      capabilityCall(() => createWorkspaceGitBranch({ workspaceId, branch }, options)),
  });
}

export function createWorkspaceFileSearchPort(
  workspace: Pick<WorkbenchServicesCapabilities["workspace"], "searchFiles">,
): import("@workbench/agent-runtime-client/environment").WorkbenchWorkspaceFileSearchPort {
  return {
    async search({ signal, ...payload }) {
      const result = await workspace.searchFiles(payload, { signal });
      return result.entries.map(({ relativePath }) => ({ relativePath }));
    },
  };
}
