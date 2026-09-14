import type { WorkbenchFileChangeMutationRequest } from "@workbench/agent-runtime-contracts/file-changes";
import { handleRpcPost, type RpcRouteGroup } from "@workbench/api/server";
import { rpcBusinessError } from "@workbench/api/errors";
import { rpcObject, rpcString, type RpcValidator } from "@workbench/api/validation";

import type { WorkspaceFileChangeProtocol } from "./file-changes";

export interface WorkspaceFileChangeRpcRoutesDependencies {
  readonly service: WorkspaceFileChangeProtocol;
  readonly projectDomainError: (error: unknown) => never;
}

const mutationPayload = rpcObject({
  workspaceId: rpcString({ minLength: 1, maxLength: 4096 }),
  threadId: rpcString({ minLength: 1, maxLength: 4096 }),
  changeSetId: rpcString({ minLength: 1, maxLength: 4096 }),
}) as RpcValidator<WorkbenchFileChangeMutationRequest>;

function isAborted(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

export function createWorkspaceFileChangeRpcRoutes({
  service,
  projectDomainError,
}: WorkspaceFileChangeRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      const operation =
        method === "workspace.fileChanges.undo"
          ? service.undo.bind(service)
          : method === "workspace.fileChanges.redo"
            ? service.redo.bind(service)
            : undefined;
      if (!operation) return undefined;
      return handleRpcPost(request, {
        method,
        payload: mutationPayload,
        loopbackOnly: true,
        handler: async (payload, context) => {
          try {
            return await operation(payload, context.signal);
          } catch (error) {
            if (isAborted(error, context.signal)) {
              throw rpcBusinessError(
                "cancelled",
                "The workspace change operation was cancelled.",
                {},
              );
            }
            projectDomainError(error);
          }
        },
      });
    },
  };
}
