import {
  WORKSPACE_FILE_EDITABLE_SIZE_LIMIT,
  WORKSPACE_FILE_RELATIVE_PATH_LENGTH_LIMIT,
} from "@/runtime/pi/contracts/rpc";
import type { WorkspaceFileProtocol } from "../../workspaces/workspace-files";
import {
  handleRpcPost,
  RPC_REQUEST_BODY_LIMITS,
  rpcBusinessError,
  rpcObject,
  rpcOptional,
  rpcString,
} from "../rpc-transport";
import type { RpcRouteGroup } from "./rpc-route-group";

export interface WorkspaceFileRpcRoutesDependencies {
  readonly service: WorkspaceFileProtocol;
  readonly projectDomainError: (error: unknown) => never;
}

const nonEmptyString = rpcString({ minLength: 1 });
const workspaceFilesListPayload = rpcObject({
  workspaceId: nonEmptyString,
  relativePath: rpcOptional(rpcString({ maxLength: WORKSPACE_FILE_RELATIVE_PATH_LENGTH_LIMIT })),
});
const workspaceFileReadPayload = rpcObject({
  workspaceId: nonEmptyString,
  relativePath: rpcString({
    minLength: 1,
    maxLength: WORKSPACE_FILE_RELATIVE_PATH_LENGTH_LIMIT,
  }),
});
const workspaceFileWritePayload = rpcObject({
  workspaceId: nonEmptyString,
  relativePath: rpcString({
    minLength: 1,
    maxLength: WORKSPACE_FILE_RELATIVE_PATH_LENGTH_LIMIT,
  }),
  content: rpcString({ maxLength: WORKSPACE_FILE_EDITABLE_SIZE_LIMIT }),
  expectedVersion: nonEmptyString,
});

function isAborted(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

async function invokeFileOperation<Value>(
  operation: () => Promise<Value>,
  signal: AbortSignal,
  cancellationMessage: string,
  projectDomainError: WorkspaceFileRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    if (isAborted(error, signal)) {
      throw rpcBusinessError("cancelled", cancellationMessage, {});
    }
    projectDomainError(error);
  }
}

export function createWorkspaceFileRpcRoutes({
  service,
  projectDomainError,
}: WorkspaceFileRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      switch (method) {
        case "workspace.files.list":
          return handleRpcPost(request, {
            method,
            payload: workspaceFilesListPayload,
            handler: (payload, context) =>
              invokeFileOperation(
                () => service.listDirectory(payload, context.signal),
                context.signal,
                "Directory listing was cancelled.",
                projectDomainError,
              ),
          });
        case "workspace.files.describe":
          return handleRpcPost(request, {
            method,
            payload: workspaceFileReadPayload,
            handler: (payload, context) =>
              invokeFileOperation(
                () => service.describeFile(payload, context.signal),
                context.signal,
                "File inspection was cancelled.",
                projectDomainError,
              ),
          });
        case "workspace.files.read":
          return handleRpcPost(request, {
            method,
            payload: workspaceFileReadPayload,
            handler: (payload, context) =>
              invokeFileOperation(
                () => service.readFile(payload, context.signal),
                context.signal,
                "File reading was cancelled.",
                projectDomainError,
              ),
          });
        case "workspace.files.write":
          return handleRpcPost(request, {
            method,
            payload: workspaceFileWritePayload,
            maxRequestBodyBytes: RPC_REQUEST_BODY_LIMITS.workspaceFileWrite,
            handler: (payload, context) =>
              invokeFileOperation(
                () => service.writeFile(payload, context.signal),
                context.signal,
                "File writing was cancelled.",
                projectDomainError,
              ),
          });
        default:
          return undefined;
      }
    },
  };
}
