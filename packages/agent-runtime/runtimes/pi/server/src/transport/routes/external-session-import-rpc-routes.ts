import {
  EXTERNAL_SESSION_SOURCES,
  type ExternalSessionImportPayload,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import type { ExternalSessionImportProtocol } from "../../imports/external-session-import-service";
import { handleRpcPost, rpcArray, rpcEnum, rpcObject, rpcString } from "@workbench/host-server/rpc";
import type { RpcRouteGroup } from "@workbench/host-server/rpc";

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
