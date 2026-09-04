import type { WorkspaceProtocolService } from "../../workspaces/workspace-protocol-service";
import { handleRpcPost, rpcBoolean, rpcObject, rpcOptional, rpcString } from "../rpc-transport";
import type { RpcRouteGroup } from "./rpc-route-group";

export interface WorkspaceRpcRoutesDependencies {
  readonly service: WorkspaceProtocolService;
  readonly projectDomainError: (error: unknown) => never;
}

const emptyPayload = rpcObject({});
const nonEmptyString = rpcString({ minLength: 1 });
const createWorkspacePayload = rpcObject({ path: rpcString() });
const renameWorkspacePayload = rpcObject({
  workspaceId: nonEmptyString,
  title: rpcString({ minLength: 1, trim: true }),
});
const workspaceIdPayload = rpcObject({ workspaceId: nonEmptyString });
const insertWorkspacePayload = rpcObject({
  workspaceId: nonEmptyString,
  beforeWorkspaceId: rpcOptional(nonEmptyString),
});
const insertSessionPayload = rpcObject({
  workspaceId: nonEmptyString,
  sessionId: nonEmptyString,
  beforeSessionId: rpcOptional(nonEmptyString),
});
const setWorkspacePinnedPayload = rpcObject({
  workspaceId: nonEmptyString,
  pinned: rpcBoolean,
});
const setSessionPinnedPayload = rpcObject({
  sessionId: nonEmptyString,
  pinned: rpcBoolean,
});
const sessionIdPayload = rpcObject({ sessionId: nonEmptyString });

async function invokeService<Value>(
  operation: () => Promise<Value>,
  projectDomainError: WorkspaceRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    projectDomainError(error);
  }
}

export function createWorkspaceRpcRoutes({
  service,
  projectDomainError,
}: WorkspaceRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      switch (method) {
        case "workspace.list":
          return handleRpcPost(request, {
            method,
            payload: emptyPayload,
            handler: () => invokeService(() => service.list(), projectDomainError),
          });
        case "workspace.listArchivedSessions":
          return handleRpcPost(request, {
            method,
            payload: emptyPayload,
            handler: () => invokeService(() => service.listArchivedSessions(), projectDomainError),
          });
        case "workspace.create":
          return handleRpcPost(request, {
            method,
            payload: createWorkspacePayload,
            handler: (payload) => invokeService(() => service.create(payload), projectDomainError),
          });
        case "workspace.rename":
          return handleRpcPost(request, {
            method,
            payload: renameWorkspacePayload,
            handler: (payload) => invokeService(() => service.rename(payload), projectDomainError),
          });
        case "workspace.delete":
          return handleRpcPost(request, {
            method,
            payload: workspaceIdPayload,
            handler: (payload) => invokeService(() => service.delete(payload), projectDomainError),
          });
        case "workspace.insertBefore":
          return handleRpcPost(request, {
            method,
            payload: insertWorkspacePayload,
            handler: (payload) =>
              invokeService(() => service.insertBefore(payload), projectDomainError),
          });
        case "workspace.insertSessionBefore":
          return handleRpcPost(request, {
            method,
            payload: insertSessionPayload,
            handler: (payload) =>
              invokeService(() => service.insertSessionBefore(payload), projectDomainError),
          });
        case "workspace.setPinned":
          return handleRpcPost(request, {
            method,
            payload: setWorkspacePinnedPayload,
            handler: (payload) =>
              invokeService(() => service.setPinned(payload), projectDomainError),
          });
        case "workspace.setSessionPinned":
          return handleRpcPost(request, {
            method,
            payload: setSessionPinnedPayload,
            handler: (payload) =>
              invokeService(() => service.setSessionPinned(payload), projectDomainError),
          });
        case "workspace.archiveSession":
          return handleRpcPost(request, {
            method,
            payload: sessionIdPayload,
            handler: (payload) =>
              invokeService(() => service.archiveSession(payload), projectDomainError),
          });
        case "workspace.unarchiveSession":
          return handleRpcPost(request, {
            method,
            payload: sessionIdPayload,
            handler: (payload) =>
              invokeService(() => service.unarchiveSession(payload), projectDomainError),
          });
        default:
          return undefined;
      }
    },
  };
}
