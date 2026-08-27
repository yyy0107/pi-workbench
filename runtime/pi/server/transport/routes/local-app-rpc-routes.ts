import type { LocalAppProtocol } from "../../local-apps/service";
import { handleRpcPost, rpcBusinessError, rpcObject, rpcString } from "../rpc-transport";
import type { RpcRouteGroup } from "./rpc-route-group";

export interface LocalAppRpcRoutesDependencies {
  readonly service: LocalAppProtocol;
  readonly projectDomainError: (error: unknown) => never;
}

const emptyPayload = rpcObject({});
const localAppOpenPayload = rpcObject({
  appId: rpcString({ minLength: 1, maxLength: 256 }),
  target: rpcString({ minLength: 1, maxLength: 32_768 }),
});

function isAborted(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

async function invokeLocalAppOperation<Value>(
  operation: () => Promise<Value>,
  signal: AbortSignal,
  cancellationMessage: string,
  projectDomainError: LocalAppRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    if (isAborted(error, signal)) {
      throw rpcBusinessError("cancelled", cancellationMessage, {}, { cause: error });
    }
    projectDomainError(error);
  }
}

export function createLocalAppRpcRoutes({
  service,
  projectDomainError,
}: LocalAppRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      switch (method) {
        case "host.localApps.list":
          return handleRpcPost(request, {
            method,
            payload: emptyPayload,
            loopbackOnly: true,
            handler: (_payload, context) =>
              invokeLocalAppOperation(
                () => service.list(context.signal),
                context.signal,
                "Local application detection was cancelled.",
                projectDomainError,
              ),
          });
        case "host.localApps.refresh":
          return handleRpcPost(request, {
            method,
            payload: emptyPayload,
            loopbackOnly: true,
            handler: (_payload, context) =>
              invokeLocalAppOperation(
                () => service.refresh(context.signal),
                context.signal,
                "Local application detection was cancelled.",
                projectDomainError,
              ),
          });
        case "host.localApps.open":
          return handleRpcPost(request, {
            method,
            payload: localAppOpenPayload,
            loopbackOnly: true,
            handler: ({ appId, target }, context) =>
              invokeLocalAppOperation(
                () => service.open(appId, target, context.signal),
                context.signal,
                "Opening the local application was cancelled.",
                projectDomainError,
              ),
          });
        default:
          return undefined;
      }
    },
  };
}
