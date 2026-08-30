import type {
  ExtensionFileReadPayload,
  ExtensionFilesListPayload,
  ExtensionIdentityPayload,
  ExtensionSetEnabledPayload,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import type { ExtensionProtocol } from "../../extensions/extension-service";
import {
  resourceListPayload,
  resourceNameValidator,
  resourceRelativeDirectoryPathValidator,
  resourceRelativeFilePathValidator,
  resourceRequestPayload,
} from "../resource-rpc-validators";
import { handleRpcPost, rpcBoolean, rpcEnum, rpcOptional, rpcString } from "../rpc-transport";
import type { RpcRouteGroup } from "./rpc-route-group";

export interface ExtensionRpcRoutesDependencies {
  readonly service: ExtensionProtocol;
  readonly projectDomainError: (error: unknown) => never;
}

const extensionIdentityFields = {
  name: resourceNameValidator,
  filePath: rpcString({ minLength: 1, maxLength: 32_768 }),
  source: rpcString({ minLength: 1, maxLength: 2_048 }),
  scope: rpcEnum(["user", "project", "temporary"]),
  origin: rpcEnum(["package", "top-level"]),
};

const extensionIdentityPayload =
  resourceRequestPayload<ExtensionIdentityPayload>(extensionIdentityFields);
const extensionFilesListPayload = resourceRequestPayload<ExtensionFilesListPayload>({
  ...extensionIdentityFields,
  relativePath: rpcOptional(resourceRelativeDirectoryPathValidator),
});
const extensionFileReadPayload = resourceRequestPayload<ExtensionFileReadPayload>({
  ...extensionIdentityFields,
  relativePath: rpcOptional(resourceRelativeFilePathValidator),
});
const extensionSetEnabledPayload = resourceRequestPayload<ExtensionSetEnabledPayload>({
  ...extensionIdentityFields,
  enabled: rpcBoolean,
});

async function invokeService<Value>(
  operation: () => Promise<Value>,
  projectDomainError: ExtensionRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    projectDomainError(error);
  }
}

export function createExtensionRpcRoutes({
  service,
  projectDomainError,
}: ExtensionRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      switch (method) {
        case "extension.list":
          return handleRpcPost(request, {
            method,
            payload: resourceListPayload,
            handler: (payload) => invokeService(() => service.list(payload), projectDomainError),
          });
        case "extension.files.read":
          return handleRpcPost(request, {
            method,
            payload: extensionFileReadPayload,
            handler: (payload) =>
              invokeService(() => service.readFile(payload), projectDomainError),
          });
        case "extension.files.list":
          return handleRpcPost(request, {
            method,
            payload: extensionFilesListPayload,
            handler: (payload) =>
              invokeService(() => service.listFiles(payload), projectDomainError),
          });
        case "extension.setEnabled":
          return handleRpcPost(request, {
            method,
            payload: extensionSetEnabledPayload,
            loopbackOnly: true,
            handler: (payload) =>
              invokeService(() => service.setEnabled(payload), projectDomainError),
          });
        case "extension.remove":
          return handleRpcPost(request, {
            method,
            payload: extensionIdentityPayload,
            loopbackOnly: true,
            handler: (payload) => invokeService(() => service.remove(payload), projectDomainError),
          });
        default:
          return undefined;
      }
    },
  };
}
