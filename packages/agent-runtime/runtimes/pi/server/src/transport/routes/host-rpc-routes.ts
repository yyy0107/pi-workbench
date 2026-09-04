import type { HostProtocol } from "../../host/host-service";
import { handleRpcPost, rpcObject, type RpcRouteGroup } from "@workbench/host-server/rpc";
export interface HostRpcRoutesDependencies {
  readonly service: HostProtocol;
  readonly projectDomainError: (error: unknown) => never;
}
const emptyPayload = rpcObject({});
export function createHostRpcRoutes({ service }: HostRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      if (method !== "host.describe") return undefined;
      return handleRpcPost(request, {
        method,
        payload: emptyPayload,
        handler: () => service.describe(),
      });
    },
  };
}
