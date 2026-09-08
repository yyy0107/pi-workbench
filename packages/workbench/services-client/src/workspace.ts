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
import type { RpcCallOptions } from "@workbench/host-client/rpc";
import { fetchFileContent, streamFileText, type StreamFileTextOptions } from "./file-content";

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

export function fetchWorkspaceFileContent(
  payload: WorkspaceFileDescribePayload,
  options?: RpcCallOptions,
): Promise<Blob> {
  return fetchFileContent(workspaceFileContentUrl(payload), options);
}

export function streamWorkspaceFileText(
  payload: WorkspaceFileDescribePayload,
  options: StreamFileTextOptions,
) {
  return streamFileText(workspaceFileContentUrl(payload), options);
}

export type {
  FileTextChunk as WorkspaceFileTextChunk,
  StreamFileTextOptions as StreamWorkspaceFileTextOptions,
} from "./file-content";

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
