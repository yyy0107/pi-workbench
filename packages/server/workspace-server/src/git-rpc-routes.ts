import {
  WORKSPACE_GIT_BRANCH_NAME_LENGTH_LIMIT,
  type WorkbenchWorkspaceGitBranchRequest as WorkspaceGitCreateBranchPayload,
  type WorkbenchWorkspaceGitRequest as WorkspaceGitDescribePayload,
  type WorkbenchWorkspaceGitBranchRequest as WorkspaceGitSwitchBranchPayload,
} from "@workbench/agent-runtime-contracts/runtime-capabilities";

import type { WorkspaceGitProtocol } from "./git";
import {
  handleRpcPost,
  rpcBusinessError,
  rpcObject,
  rpcOptional,
  rpcNumber,
  rpcString,
  rpcEnum,
  rpcBoolean,
  type RpcValidator,
} from "@workbench/host-server/rpc";
import type { RpcRouteGroup } from "@workbench/host-server/rpc";

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
const diffPayload = rpcObject({
  workspaceId: nonEmptyString,
  scope: rpcEnum([
    "uncommitted",
    "unstaged",
    "staged",
    "branch",
    "commit",
    "range",
    "session",
    "last-turn",
  ]),
  fullContext: rpcOptional(rpcBoolean),
  exportPatch: rpcOptional(rpcBoolean),
  revision: rpcOptional(branchName),
  baseRevision: rpcOptional(branchName),
  sessionId: rpcOptional(rpcString({ minLength: 1, maxLength: 256 })),
  path: rpcOptional(rpcString({ minLength: 1, maxLength: 4096 })),
  offset: rpcOptional(rpcNumber({ integer: true, minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  patchVersion: rpcOptional(rpcString({ minLength: 64, maxLength: 64 })),
});
const logPayload = rpcObject({
  workspaceId: nonEmptyString,
  offset: rpcOptional(rpcNumber({ integer: true, minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
});
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
        case "workspace.git.diff":
          return handleRpcPost(request, {
            method,
            payload: diffPayload,
            handler: (payload, context) =>
              invokeService(
                () => service.diff(payload, context.signal),
                context.signal,
                projectDomainError,
              ),
          });
        case "workspace.git.log":
          return handleRpcPost(request, {
            method,
            payload: logPayload,
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
