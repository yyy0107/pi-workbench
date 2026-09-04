import {
  WORKSPACE_GIT_BRANCH_NAME_LENGTH_LIMIT,
  type WorkspaceGitCreateBranchPayload,
  type WorkspaceGitDescribePayload,
  type WorkspaceGitSwitchBranchPayload,
} from "@workbench/agent-runtime-pi-protocol/rpc";

import type { WorkspaceGitProtocol } from "../../workspaces/workspace-git";
import {
  handleRpcPost,
  rpcBusinessError,
  rpcObject,
  rpcString,
  type RpcValidator,
} from "../rpc-transport";
import type { RpcRouteGroup } from "./rpc-route-group";

export interface WorkspaceGitRpcRoutesDependencies {
  readonly service: WorkspaceGitProtocol;
  readonly projectDomainError: (error: unknown) => never;
}

const nonEmptyString = rpcString({ minLength: 1 });
const branchName = rpcString({
  minLength: 1,
  maxLength: WORKSPACE_GIT_BRANCH_NAME_LENGTH_LIMIT,
  trim: true,
});
const describePayload = rpcObject({
  workspaceId: nonEmptyString,
}) as RpcValidator<WorkspaceGitDescribePayload>;
const switchBranchPayload = rpcObject({
  workspaceId: nonEmptyString,
  branch: branchName,
}) as RpcValidator<WorkspaceGitSwitchBranchPayload>;
const createBranchPayload = rpcObject({
  workspaceId: nonEmptyString,
  branch: branchName,
}) as RpcValidator<WorkspaceGitCreateBranchPayload>;

function isAborted(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

async function invokeService<Value>(
  operation: () => Promise<Value>,
  signal: AbortSignal,
  projectDomainError: WorkspaceGitRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    if (isAborted(error, signal)) {
      throw rpcBusinessError("cancelled", "The Git operation was cancelled.", {});
    }
    projectDomainError(error);
  }
}

export function createWorkspaceGitRpcRoutes({
  service,
  projectDomainError,
}: WorkspaceGitRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      switch (method) {
        case "workspace.git.describe":
          return handleRpcPost(request, {
            method,
            payload: describePayload,
            handler: (payload, context) =>
              invokeService(
                () => service.describe(payload, context.signal),
                context.signal,
                projectDomainError,
              ),
          });
        case "workspace.git.log":
          return handleRpcPost(request, {
            method,
            payload: describePayload,
            handler: (payload, context) =>
              invokeService(
                () => service.log(payload, context.signal),
                context.signal,
                projectDomainError,
              ),
          });
        case "workspace.git.switchBranch":
          return handleRpcPost(request, {
            method,
            payload: switchBranchPayload,
            loopbackOnly: true,
            handler: (payload, context) =>
              invokeService(
                () => service.switchBranch(payload, context.signal),
                context.signal,
                projectDomainError,
              ),
          });
        case "workspace.git.createBranch":
          return handleRpcPost(request, {
            method,
            payload: createBranchPayload,
            loopbackOnly: true,
            handler: (payload, context) =>
              invokeService(
                () => service.createBranch(payload, context.signal),
                context.signal,
                projectDomainError,
              ),
          });
        default:
          return undefined;
      }
    },
  };
}
