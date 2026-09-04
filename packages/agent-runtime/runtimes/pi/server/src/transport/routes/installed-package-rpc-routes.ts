import type { InstalledPackageProtocol } from "../../packages/installed-package-service";
import {
  packageDescribePayload,
  packageInstallPayload,
  packageSourceMutationPayload,
} from "../package-rpc-validators";
import { resourceListPayload } from "../resource-rpc-validators";
import { handleRpcPost } from "../rpc-transport";
import type { RpcRouteGroup } from "./rpc-route-group";

export interface InstalledPackageRpcRoutesDependencies {
  readonly service: InstalledPackageProtocol;
  readonly projectDomainError: (error: unknown) => never;
}

async function invokeService<Value>(
  operation: () => Promise<Value>,
  projectDomainError: InstalledPackageRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    projectDomainError(error);
  }
}

export function createInstalledPackageRpcRoutes({
  service,
  projectDomainError,
}: InstalledPackageRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      switch (method) {
        case "package.list":
          return handleRpcPost(request, {
            method,
            payload: resourceListPayload,
            handler: (payload) => invokeService(() => service.list(payload), projectDomainError),
          });
        case "package.describe":
          return handleRpcPost(request, {
            method,
            payload: packageDescribePayload,
            handler: (payload) =>
              invokeService(() => service.describe(payload), projectDomainError),
          });
        case "package.updates":
          return handleRpcPost(request, {
            method,
            payload: resourceListPayload,
            handler: (payload) => invokeService(() => service.updates(payload), projectDomainError),
          });
        case "package.install":
          return handleRpcPost(request, {
            method,
            payload: packageInstallPayload,
            loopbackOnly: true,
            handler: (payload) => invokeService(() => service.install(payload), projectDomainError),
          });
        case "package.update":
          return handleRpcPost(request, {
            method,
            payload: packageSourceMutationPayload,
            loopbackOnly: true,
            handler: (payload) => invokeService(() => service.update(payload), projectDomainError),
          });
        case "package.remove":
          return handleRpcPost(request, {
            method,
            payload: packageSourceMutationPayload,
            loopbackOnly: true,
            handler: (payload) => invokeService(() => service.remove(payload), projectDomainError),
          });
        default:
          return undefined;
      }
    },
  };
}
