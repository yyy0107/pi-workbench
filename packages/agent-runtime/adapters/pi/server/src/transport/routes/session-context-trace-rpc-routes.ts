import type { PiSessionContextTraceService } from "../../sessions/pi-session-context-trace-service";
import { handleRpcPost, rpcInteger, rpcObject, rpcOptional, rpcString } from "../rpc-transport";
import type { RpcRouteGroup } from "./rpc-route-group";

export interface SessionContextTraceRpcRoutesDependencies {
  readonly service: PiSessionContextTraceService;
  readonly projectDomainError: (error: unknown) => never;
}

export type SessionContextTraceRpcRoutes = RpcRouteGroup;

const nonEmptyString = rpcString({ minLength: 1 });
const sessionContextTraceListPayload = rpcObject({
  sessionId: nonEmptyString,
  activationId: rpcOptional(rpcString({ minLength: 1, maxLength: 128 })),
  afterSeq: rpcOptional(rpcInteger({ minimum: -1 })),
  limit: rpcOptional(rpcInteger({ minimum: 1, maximum: 500 })),
});
const sessionContextTraceActivationsPayload = rpcObject({
  sessionId: nonEmptyString,
});
const sessionContextTracePromptPartsPayload = rpcObject({
  sessionId: nonEmptyString,
});
const sessionContextTraceReadPayload = rpcObject({
  sessionId: nonEmptyString,
  traceId: rpcString({ minLength: 1, maxLength: 256 }),
});

async function invokeService<Value>(
  operation: () => Promise<Value>,
  projectDomainError: SessionContextTraceRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    projectDomainError(error);
  }
}

export function createSessionContextTraceRpcRoutes({
  service,
  projectDomainError,
}: SessionContextTraceRpcRoutesDependencies): SessionContextTraceRpcRoutes {
  return {
    handle(request, method) {
      switch (method) {
        case "session.contextTrace.list":
          return handleRpcPost(request, {
            method,
            payload: sessionContextTraceListPayload,
            loopbackOnly: true,
            handler: (payload) => invokeService(() => service.list(payload), projectDomainError),
          });
        case "session.contextTrace.activations":
          return handleRpcPost(request, {
            method,
            payload: sessionContextTraceActivationsPayload,
            loopbackOnly: true,
            handler: (payload) =>
              invokeService(() => service.activations(payload), projectDomainError),
          });
        case "session.contextTrace.promptParts":
          return handleRpcPost(request, {
            method,
            payload: sessionContextTracePromptPartsPayload,
            loopbackOnly: true,
            handler: (payload) =>
              invokeService(() => service.promptParts(payload), projectDomainError),
          });
        case "session.contextTrace.read":
          return handleRpcPost(request, {
            method,
            payload: sessionContextTraceReadPayload,
            loopbackOnly: true,
            handler: (payload) => invokeService(() => service.read(payload), projectDomainError),
          });
        default:
          return undefined;
      }
    },
  };
}
