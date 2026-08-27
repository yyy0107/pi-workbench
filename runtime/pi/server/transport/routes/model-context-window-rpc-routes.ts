import type {
  ModelContextWindowPayload,
  UpdateModelContextWindowPayload,
} from "@/runtime/pi/contracts/rpc";
import type { ModelContextWindowProtocol } from "../../models/model-service";
import {
  handleRpcPost,
  rpcBusinessError,
  rpcInteger,
  rpcObject,
  rpcString,
  type RpcValidator,
} from "../rpc-transport";
import type { RpcRouteGroup } from "./rpc-route-group";

export interface ModelContextWindowRpcRoutesDependencies {
  readonly service: ModelContextWindowProtocol;
  readonly notifyProviderConfigurationChanged: (provider: string) => void;
  readonly projectDomainError: (error: unknown) => never;
}

const nonEmptyString = rpcString({ minLength: 1 });
const modelContextWindowPayload = rpcObject({
  provider: nonEmptyString,
  model: nonEmptyString,
}) as RpcValidator<ModelContextWindowPayload>;
const updateModelContextWindowPayload = rpcObject({
  provider: nonEmptyString,
  model: nonEmptyString,
  contextWindow: rpcInteger({ minimum: 1, maximum: 10_000_000 }),
}) as RpcValidator<UpdateModelContextWindowPayload>;

function isAborted(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

async function invokeService<Value>(
  operation: () => Promise<Value>,
  projectDomainError: ModelContextWindowRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    projectDomainError(error);
  }
}

async function invokeCancellable<Value>(
  operation: () => Promise<Value>,
  signal: AbortSignal,
  cancelledMessage: string,
  projectDomainError: ModelContextWindowRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    if (isAborted(error, signal)) {
      throw rpcBusinessError("cancelled", cancelledMessage, {}, { cause: error });
    }
    projectDomainError(error);
  }
}

export function createModelContextWindowRpcRoutes({
  service,
  notifyProviderConfigurationChanged,
  projectDomainError,
}: ModelContextWindowRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      switch (method) {
        case "llm.modelContextWindow":
          return handleRpcPost(request, {
            method,
            payload: modelContextWindowPayload,
            handler: (payload) =>
              invokeService(() => service.modelContextWindow(payload), projectDomainError),
          });
        case "llm.updateModelContextWindow":
          return handleRpcPost(request, {
            method,
            payload: updateModelContextWindowPayload,
            loopbackOnly: true,
            handler: async (payload, context) => {
              const value = await invokeCancellable(
                () => service.updateModelContextWindow(payload, { signal: context.signal }),
                context.signal,
                "Model context-window update was cancelled.",
                projectDomainError,
              );
              notifyProviderConfigurationChanged(payload.provider);
              return value;
            },
          });
        case "llm.resetModelContextWindow":
          return handleRpcPost(request, {
            method,
            payload: modelContextWindowPayload,
            loopbackOnly: true,
            handler: async (payload, context) => {
              const value = await invokeCancellable(
                () => service.resetModelContextWindow(payload, { signal: context.signal }),
                context.signal,
                "Model context-window reset was cancelled.",
                projectDomainError,
              );
              notifyProviderConfigurationChanged(payload.provider);
              return value;
            },
          });
        default:
          return undefined;
      }
    },
  };
}
