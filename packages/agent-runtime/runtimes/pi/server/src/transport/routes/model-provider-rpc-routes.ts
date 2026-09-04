import { RPC_REQUEST_BODY_LIMITS } from "../rpc-request-budgets";
import type {
  ConfigureModelProviderPayload,
  DiscoverModelsPayload,
  ModelProviderConfigPayload,
  ModelProviderLoginPayload,
  RemoveModelProviderPayload,
  RespondModelProviderLoginPayload,
  StartModelProviderLoginPayload,
  TestModelImageInputPayload,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import type { ModelProviderProtocol } from "../../models/model-service";
import {
  handleRpcPost,
  rpcArray,
  rpcBoolean,
  rpcBusinessError,
  rpcEnum,
  rpcInteger,
  rpcLiteral,
  rpcNullable,
  rpcObject,
  rpcOptional,
  rpcString,
  type RpcValidator,
} from "@workbench/host-server/rpc";
import type { RpcRouteGroup } from "@workbench/host-server/rpc";

export interface ModelProviderRpcRoutesDependencies {
  readonly service: ModelProviderProtocol;
  readonly notifyProviderConfigurationChanged: (provider: string) => void;
  readonly projectDomainError: (error: unknown) => never;
}

const emptyPayload = rpcObject({});
const nonEmptyString = rpcString({ minLength: 1 });
const providerPayload = rpcObject({
  provider: nonEmptyString,
}) as RpcValidator<ModelProviderConfigPayload & RemoveModelProviderPayload>;
const discoverModelsPayload = rpcObject({
  settingsNs: nonEmptyString,
  provider: rpcOptional(nonEmptyString),
  baseURL: rpcOptional(nonEmptyString),
  api: rpcOptional(nonEmptyString),
  apiKey: rpcOptional(nonEmptyString),
  source: rpcOptional(rpcEnum(["catalog", "provider", "endpoint"])),
}) as RpcValidator<DiscoverModelsPayload>;
const testModelImageInputPayload = rpcObject({
  provider: nonEmptyString,
  model: nonEmptyString,
}) as RpcValidator<TestModelImageInputPayload>;
const thinkingLevelValue = rpcNullable(rpcString());
const thinkingLevelMap = rpcObject({
  off: rpcOptional(thinkingLevelValue),
  minimal: rpcOptional(thinkingLevelValue),
  low: rpcOptional(thinkingLevelValue),
  medium: rpcOptional(thinkingLevelValue),
  high: rpcOptional(thinkingLevelValue),
  xhigh: rpcOptional(thinkingLevelValue),
  max: rpcOptional(thinkingLevelValue),
});
const providerModelConfiguration = rpcObject({
  id: nonEmptyString,
  name: rpcOptional(rpcString()),
  contextWindow: rpcOptional(rpcInteger({ minimum: 1 })),
  maxTokens: rpcOptional(rpcInteger({ minimum: 1 })),
  reasoning: rpcOptional(rpcBoolean),
  thinkingLevelMap: rpcOptional(thinkingLevelMap),
  input: rpcOptional(rpcArray(rpcEnum(["text", "image"]))),
  imageInputSource: rpcOptional(rpcEnum(["provider-api", "runtime", "test", "user"])),
});
const providerConfiguration = rpcObject({
  displayName: rpcOptional(rpcString()),
  baseURL: nonEmptyString,
  api: rpcEnum([
    "anthropic-messages",
    "openai-completions",
    "openai-responses",
    "google-generative-ai",
  ]),
  models: rpcOptional(rpcArray(providerModelConfiguration)),
});
const configureProviderPayload = rpcObject({
  provider: nonEmptyString,
  apiKey: rpcOptional(rpcString({ minLength: 1, trim: true })),
  configuration: rpcOptional(providerConfiguration),
}) as RpcValidator<ConfigureModelProviderPayload>;
const startProviderLoginPayload = rpcObject({
  provider: nonEmptyString,
  authType: rpcLiteral("oauth"),
}) as RpcValidator<StartModelProviderLoginPayload>;
const providerLoginPayload = rpcObject({
  loginId: rpcString({ minLength: 1, maxLength: 256 }),
}) as RpcValidator<ModelProviderLoginPayload>;
const respondProviderLoginPayload = rpcObject({
  loginId: rpcString({ minLength: 1, maxLength: 256 }),
  promptId: rpcString({ minLength: 1, maxLength: 256 }),
  value: rpcString({ maxLength: 16_384 }),
}) as RpcValidator<RespondModelProviderLoginPayload>;

function isAborted(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

async function invokeService<Value>(
  operation: () => Value | Promise<Value>,
  projectDomainError: ModelProviderRpcRoutesDependencies["projectDomainError"],
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
  projectDomainError: ModelProviderRpcRoutesDependencies["projectDomainError"],
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

export function createModelProviderRpcRoutes({
  service,
  notifyProviderConfigurationChanged,
  projectDomainError,
}: ModelProviderRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      switch (method) {
        case "llm.providers":
          return handleRpcPost(request, {
            method,
            payload: emptyPayload,
            handler: async () => {
              const value = await service.providers();
              // Reading providers also detects credentials changed by Pi TUI.
              for (const provider of value.providers) {
                if (provider.active) notifyProviderConfigurationChanged(provider.provider);
              }
              return value;
            },
          });
        case "llm.providerConfig":
          return handleRpcPost(request, {
            method,
            payload: providerPayload,
            handler: (payload) => service.providerConfig(payload),
          });
        case "llm.startProviderLogin":
          return handleRpcPost(request, {
            method,
            payload: startProviderLoginPayload,
            loopbackOnly: true,
            handler: (payload) =>
              invokeService(() => service.startProviderLogin(payload), projectDomainError),
          });
        case "llm.providerLogin":
          return handleRpcPost(request, {
            method,
            payload: providerLoginPayload,
            loopbackOnly: true,
            handler: async (payload) => {
              const value = await invokeService(
                () => service.providerLogin(payload),
                projectDomainError,
              );
              if (value.status === "complete") {
                notifyProviderConfigurationChanged(value.provider);
              }
              return value;
            },
          });
        case "llm.respondProviderLogin":
          return handleRpcPost(request, {
            method,
            payload: respondProviderLoginPayload,
            loopbackOnly: true,
            handler: async (payload) => {
              const value = await invokeService(
                () => service.respondProviderLogin(payload),
                projectDomainError,
              );
              if (value.status === "complete") {
                notifyProviderConfigurationChanged(value.provider);
              }
              return value;
            },
          });
        case "llm.cancelProviderLogin":
          return handleRpcPost(request, {
            method,
            payload: providerLoginPayload,
            loopbackOnly: true,
            handler: (payload) =>
              invokeService(() => service.cancelProviderLogin(payload), projectDomainError),
          });
        case "llm.configureProvider":
          return handleRpcPost(request, {
            method,
            payload: configureProviderPayload,
            maxRequestBodyBytes: RPC_REQUEST_BODY_LIMITS.modelProviderConfiguration,
            loopbackOnly: true,
            handler: async (payload, context) => {
              const value = await invokeCancellable(
                () => service.configureProvider(payload, { signal: context.signal }),
                context.signal,
                "Provider configuration was cancelled.",
                projectDomainError,
              );
              notifyProviderConfigurationChanged(payload.provider);
              return value;
            },
          });
        case "llm.removeProvider":
          return handleRpcPost(request, {
            method,
            payload: providerPayload,
            loopbackOnly: true,
            handler: async (payload, context) => {
              const value = await invokeCancellable(
                () => service.removeProvider(payload, { signal: context.signal }),
                context.signal,
                "Provider removal was cancelled.",
                projectDomainError,
              );
              notifyProviderConfigurationChanged(payload.provider);
              return value;
            },
          });
        case "llm.models":
          return handleRpcPost(request, {
            method,
            payload: emptyPayload,
            handler: () => service.models(),
          });
        case "llm.discoverModels":
          return handleRpcPost(request, {
            method,
            payload: discoverModelsPayload,
            loopbackOnly: true,
            handler: (payload, context) =>
              invokeCancellable(
                () => service.discoverModels(payload, { signal: context.signal }),
                context.signal,
                "Model discovery was cancelled.",
                projectDomainError,
              ),
          });
        case "llm.testModelImageInput":
          return handleRpcPost(request, {
            method,
            payload: testModelImageInputPayload,
            loopbackOnly: true,
            handler: (payload, context) =>
              invokeCancellable(
                () => service.testModelImageInput(payload, { signal: context.signal }),
                context.signal,
                "Model image-input test was cancelled.",
                projectDomainError,
              ),
          });
        default:
          return undefined;
      }
    },
  };
}
