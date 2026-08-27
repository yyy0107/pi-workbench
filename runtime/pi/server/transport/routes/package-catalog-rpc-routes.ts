import type { PackageCatalogProtocol } from "../../packages/package-catalog-service";
import {
  packageCatalogDescribePayload,
  packageCatalogSearchPayload,
} from "../package-rpc-validators";
import { handleRpcPost } from "../rpc-transport";
import type { RpcRouteGroup } from "./rpc-route-group";

export interface PackageCatalogRpcRoutesDependencies {
  readonly service: PackageCatalogProtocol;
  readonly projectDomainError: (error: unknown) => never;
}

async function invokeService<Value>(
  operation: () => Promise<Value>,
  projectDomainError: PackageCatalogRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    projectDomainError(error);
  }
}

export function createPackageCatalogRpcRoutes({
  service,
  projectDomainError,
}: PackageCatalogRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      switch (method) {
        case "packageCatalog.search":
          return handleRpcPost(request, {
            method,
            payload: packageCatalogSearchPayload,
            handler: (payload, context) =>
              invokeService(() => service.search(payload, context.signal), projectDomainError),
          });
        case "packageCatalog.describe":
          return handleRpcPost(request, {
            method,
            payload: packageCatalogDescribePayload,
            handler: (payload, context) =>
              invokeService(() => service.describe(payload, context.signal), projectDomainError),
          });
        default:
          return undefined;
      }
    },
  };
}
