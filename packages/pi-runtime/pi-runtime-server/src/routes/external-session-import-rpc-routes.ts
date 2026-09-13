import {
  EXTERNAL_SESSION_SOURCES,
  type ExternalSessionImportPayload,
} from "@workbench/pi-rpc-contracts/rpc";
import type { ExternalSessionImportProtocol } from "@workbench/pi-sdk-sessions/imports";
import { handleRpcPost } from "@workbench/api/server";
import { rpcArray, rpcEnum, rpcObject, rpcString } from "@workbench/api/validation";
import type { RpcRouteGroup } from "@workbench/api/server";

export interface ExternalSessionImportRpcRoutesDependencies {
  readonly service: ExternalSessionImportProtocol;
}

const emptyPayload = rpcObject({});
const externalSessionSource = rpcEnum(EXTERNAL_SESSION_SOURCES);
const externalSessionImportPayload = rpcObject({
  sessions: rpcArray(
    rpcObject({
      source: externalSessionSource,
      sourceSessionId: rpcString({ minLength: 1, maxLength: 512 }),
    }),
    { maxLength: 200 },
  ),
});

export function createExternalSessionImportRpcRoutes({
  service,
}: ExternalSessionImportRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      switch (method) {
        case "sessionImport.scan":
          return handleRpcPost(request, {
            method,
            payload: emptyPayload,
            loopbackOnly: true,
            handler: () => service.scan(),
          });
        case "sessionImport.import":
          return handleRpcPost(request, {
            method,
            payload: externalSessionImportPayload,
            loopbackOnly: true,
            handler: (payload: ExternalSessionImportPayload) => service.import(payload.sessions),
          });
        default:
          return undefined;
      }
    },
  };
}
