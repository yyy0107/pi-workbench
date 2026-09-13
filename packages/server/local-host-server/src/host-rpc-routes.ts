import type { LocalHostProtocol as HostProtocol } from "./service";
import {
  handleRpcPost,
  rpcBusinessError,
  rpcObject,
  rpcOptional,
  rpcString,
} from "@workbench/host-server/rpc";
import type { RpcRouteGroup } from "@workbench/host-server/rpc";

export interface HostRpcRoutesDependencies {
  readonly service: HostProtocol;
  readonly projectDomainError: (error: unknown) => never;
}

const emptyPayload = rpcObject({});
const nonEmptyString = rpcString({ minLength: 1 });
const optionalPathPayload = rpcObject({ path: rpcOptional(rpcString()) });
const createDirectoryPayload = rpcObject({
  path: rpcString(),
  name: rpcString(),
});
const pathPayload = rpcObject({ path: nonEmptyString });

function isAborted(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

async function invokeHostOperation<Value>(
  operation: () => Promise<Value>,
  projectDomainError: HostRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    projectDomainError(error);
  }
}

async function invokeCancellableHostOperation<Value>(
  operation: () => Promise<Value>,
  signal: AbortSignal,
  cancellationMessage: string,
  projectDomainError: HostRpcRoutesDependencies["projectDomainError"],
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

export function createLocalHostRpcRoutes({
  service,
  projectDomainError,
}: HostRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      switch (method) {
        case "host.pickDirectory":
          return handleRpcPost(request, {
            method,
            payload: emptyPayload,
            loopbackOnly: true,
            handler: (_payload, context) =>
              invokeCancellableHostOperation(
                () => service.pickDirectory(context.signal),
                context.signal,
                "Directory selection was cancelled.",
                projectDomainError,
              ),
          });
        case "host.listDirectory":
          return handleRpcPost(request, {
            method,
            payload: optionalPathPayload,
            handler: ({ path }, context) =>
              invokeCancellableHostOperation(
                () => service.listDirectory(path, context.signal),
                context.signal,
                "Directory listing was cancelled.",
                projectDomainError,
              ),
          });
        case "host.createDirectory":
          return handleRpcPost(request, {
            method,
            payload: createDirectoryPayload,
            handler: (payload) =>
              invokeHostOperation(() => service.createDirectory(payload), projectDomainError),
          });
        case "host.openPath":
          return handleRpcPost(request, {
            method,
            payload: pathPayload,
            loopbackOnly: true,
            handler: async ({ path }, context) => {
              try {
                return await service.openPath(path, context.signal);
              } catch (error) {
                if (isAborted(error, context.signal)) {
                  throw rpcBusinessError(
                    "cancelled",
                    "Opening the host path was cancelled.",
                    {},
                    { cause: error },
                  );
                }
                throw rpcBusinessError(
                  "internal",
                  "The host could not open the requested path.",
                  {},
                  { cause: error },
                );
              }
            },
          });
        default:
          return undefined;
      }
    },
  };
}
