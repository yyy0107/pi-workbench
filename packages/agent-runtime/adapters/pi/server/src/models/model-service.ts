import { createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import type {
  Api,
  AssistantMessage,
  AuthEvent,
  Context,
  KnownProvider,
  Model,
  ModelsApiStreamOptions,
} from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

import {
  PI_THINKING_LEVELS,
  type PiThinkingLevel,
} from "@workbench/agent-runtime-pi-protocol/messages";
import {
  imageInputCapability,
  type ModelInputModality,
} from "@workbench/agent-runtime-pi-shared/models";
import { RpcDomainError } from "@workbench/server-core/rpc-domain-error";
import type {
  ConfigurableProviderView,
  ConfigureModelProviderPayload,
  DiscoverModelsPayload,
  DiscoverModelsValue,
  DiscoveredModel,
  ModelCatalogFailure,
  ModelCatalogModel,
  ModelCatalogValue,
  ModelCapabilityState,
  ModelContextWindowPayload,
  ModelContextWindowValue,
  ModelDiscoveryFailureDetails,
  ModelDiscoveryFailureReason,
  ModelProviderGroup,
  ModelProviderConfigPayload,
  ModelProviderConfigValue,
  ModelProviderLoginPayload,
  ModelProviderLoginValue,
  ModelProviderModelConfiguration,
  ModelProvidersValue,
  RemoveModelProviderPayload,
  RespondModelProviderLoginPayload,
  StartModelProviderLoginPayload,
  TestModelImageInputPayload,
  TestModelImageInputValue,
  UpdateModelContextWindowPayload,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import {
  ModelConfigStore,
  type ModelConfigMutation,
  type ModelConfigStorage,
  type StoredModelProviderConfiguration,
} from "./model-config-store";
import { getProjectTrustService } from "../trust/project-trust-service";

export type {
  ConfigurableProviderView,
  DiscoveredModel,
  ModelCatalogFailure,
  ModelCatalogModel,
  ModelProviderGroup,
  ModelSelection,
} from "@workbench/agent-runtime-pi-protocol/rpc";

export type ModelProvidersResult = ModelProvidersValue;
export type ModelCatalogResult = ModelCatalogValue;
export type DiscoverModelsInput = DiscoverModelsPayload;
export type DiscoverModelsResult = DiscoverModelsValue;

/** Stable transport-facing provider, authentication, catalog, and discovery operations. */
export interface ModelProviderProtocol {
  providers(): Promise<ModelProvidersResult>;
  providerConfig(input: ModelProviderConfigPayload): Promise<ModelProviderConfigValue>;
  startProviderLogin(input: StartModelProviderLoginPayload): Promise<ModelProviderLoginValue>;
  providerLogin(input: ModelProviderLoginPayload): ModelProviderLoginValue;
  respondProviderLogin(input: RespondModelProviderLoginPayload): ModelProviderLoginValue;
  cancelProviderLogin(input: ModelProviderLoginPayload): ModelProviderLoginValue;
  configureProvider(
    input: ConfigureModelProviderPayload,
    options?: { signal?: AbortSignal },
  ): Promise<ModelProvidersResult>;
  removeProvider(
    input: RemoveModelProviderPayload,
    options?: { signal?: AbortSignal },
  ): Promise<ModelProvidersResult>;
  models(): Promise<ModelCatalogResult>;
  discoverModels(
    input: DiscoverModelsInput,
    options?: { signal?: AbortSignal },
  ): Promise<DiscoverModelsResult>;
  testModelImageInput(
    input: TestModelImageInputPayload,
    options?: { signal?: AbortSignal },
  ): Promise<TestModelImageInputValue>;
}

/** Stable transport-facing model-capacity overrides; Pi runtime ownership stays in this service. */
export interface ModelContextWindowProtocol {
  modelContextWindow(input: ModelContextWindowPayload): Promise<ModelContextWindowValue>;
  updateModelContextWindow(
    input: UpdateModelContextWindowPayload,
    options?: { signal?: AbortSignal },
  ): Promise<ModelContextWindowValue>;
  resetModelContextWindow(
    input: ModelContextWindowPayload,
    options?: { signal?: AbortSignal },
  ): Promise<ModelContextWindowValue>;
}

export interface ModelServiceErrorDetails {
  "model-discovery-failed": ModelDiscoveryFailureDetails;
  "model-provider-not-found": {
    provider: string;
  };
  "model-provider-api-key-unsupported": {
    provider: string;
  };
  "model-provider-account-login-unsupported": {
    provider: string;
  };
  "model-provider-login-in-progress": {
    provider: string;
  };
  "model-provider-login-not-found": {
    loginId: string;
  };
  "model-provider-login-prompt-mismatch": {
    loginId: string;
  };
  "model-provider-configuration-failed": {
    provider: string;
  };
  "model-provider-configuration-readonly": {
    provider: string;
  };
  "model-not-found": {
    provider: string;
    model: string;
  };
}

export type ModelServiceErrorCode = keyof ModelServiceErrorDetails;

export class ModelServiceError<
  Code extends ModelServiceErrorCode = ModelServiceErrorCode,
> extends RpcDomainError<Code, ModelServiceErrorDetails[Code]> {
  readonly code: Code;
  readonly details: ModelServiceErrorDetails[Code];

  constructor(
    code: Code,
    message: string,
    details: ModelServiceErrorDetails[Code],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ModelServiceError";
    this.code = code;
    this.details = details;
  }
}

/** The subset of pi-ai's Model used by the HTTP model catalog. */
export interface ModelRuntimeModel {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  thinkingLevelMap?: Partial<Record<PiThinkingLevel, string | null>>;
  contextWindow: number;
  maxTokens: number;
  input?: Array<"text" | "image">;
  api?: string;
  baseUrl?: string;
}

/** The subset of pi-ai's Provider used by the HTTP model catalog. */
export interface ModelRuntimeProvider {
  id: string;
  name: string;
  baseUrl?: string;
  auth?: {
    apiKey?: {
      name?: string;
      login?: unknown;
    };
    oauth?: {
      name?: string;
      isSubscription?: boolean;
      loginLabel?: string;
      login?: unknown;
    };
  };
}

export type ModelRuntimeAuthSource =
  | "stored"
  | "runtime"
  | "environment"
  | "fallback"
  | "models_json_key"
  | "models_json_command";

export interface ModelRuntimeAuthStatus {
  configured: boolean;
  source?: ModelRuntimeAuthSource;
  label?: string;
}

export interface ModelRuntimeAuthPrompt {
  type: "text" | "secret" | "select" | "manual_code";
  message?: string;
  placeholder?: string;
  options?: readonly { id: string; label: string; description?: string }[];
  signal?: AbortSignal;
}

export interface ModelRuntimeAuthInteraction {
  signal?: AbortSignal;
  prompt(prompt: ModelRuntimeAuthPrompt): Promise<string>;
  notify(event: AuthEvent): void;
}

export interface ModelRuntimeRefreshResult {
  aborted: boolean;
  errors: ReadonlyMap<string, Error>;
}

export interface ModelRuntimeAuthResult {
  auth: {
    apiKey?: string;
  };
}

/**
 * Public ModelRuntime surface used by this service. Keeping this structural
 * makes the domain service cheap to test without constructing an AgentSession.
 */
export interface ModelRuntimeLike {
  getProviders(): readonly ModelRuntimeProvider[];
  getModels(provider?: string): readonly ModelRuntimeModel[];
  getAvailable(provider?: string): Promise<readonly ModelRuntimeModel[]>;
  refresh(options?: {
    allowNetwork?: boolean;
    providers?: readonly string[];
    force?: boolean;
    signal?: AbortSignal;
  }): Promise<ModelRuntimeRefreshResult>;
  getAvailableSnapshot?(): readonly ModelRuntimeModel[];
  getError?(): string | undefined;
  getRegisteredProviderIds?(): readonly string[];
  getProviderAuthStatus?(provider: string): ModelRuntimeAuthStatus;
  isUsingOAuth?(provider: string): boolean;
  getAuth?(
    provider: string,
    options?: { signal?: AbortSignal },
  ): Promise<ModelRuntimeAuthResult | undefined>;
  setRuntimeApiKey?(provider: string, apiKey: string): Promise<void>;
  removeRuntimeApiKey?(provider: string): Promise<void>;
  login?(
    provider: string,
    type: "api_key" | "oauth",
    interaction: ModelRuntimeAuthInteraction,
  ): Promise<unknown>;
  logout?(provider: string, options?: { signal?: AbortSignal }): Promise<void>;
  getModel?(provider: string, model: string): Model<Api> | undefined;
  complete?<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ModelsApiStreamOptions<TApi>,
  ): Promise<AssistantMessage>;
}

export interface ModelServiceDiagnostic {
  type: "info" | "warning" | "error";
  message: string;
}

export interface ModelServiceServices {
  modelRuntime: ModelRuntimeLike;
  diagnostics?: readonly ModelServiceDiagnostic[];
}

export interface ModelServiceFactoryOptions {
  cwd: string;
  resourceLoaderReloadOptions: {
    resolveProjectTrust: () => Promise<boolean>;
  };
}

export type ModelServiceFactory = (
  options: ModelServiceFactoryOptions,
) => Promise<ModelServiceServices>;

export interface ModelProviderSettings {
  displayName?: string;
  settingsNs?: string;
  settingsPath?: readonly string[];
  declared?: boolean;
}

export interface ModelServiceOptions {
  cwd?: string;
  serviceFactory?: ModelServiceFactory;
  runtime?: ModelRuntimeLike;
  /** Injectable transport for request-scoped provider model discovery. */
  fetcher?: typeof fetch;
  /** Overrides wire metadata when a provider is exposed by another settings namespace. */
  providerSettings?: Readonly<Record<string, ModelProviderSettings>>;
  modelConfigStore?: ModelConfigStorage;
}

interface LoadedModelServices {
  runtime: ModelRuntimeLike;
  diagnostics: readonly ModelServiceDiagnostic[];
}

interface ModelProviderLoginSession {
  value: ModelProviderLoginValue;
  controller: AbortController;
  answerPrompt?: (value: string) => void;
  rejectPrompt?: (reason: unknown) => void;
}

const RUNTIME_FAILURE_ID = "model-runtime";
const RUNTIME_FAILURE_NAME = "Model runtime";
const MODEL_LISTING_RESPONSE_LIMIT = 4 * 1024 * 1024;
const MODEL_LISTING_PAGE_LIMIT = 1000;
const MODEL_LISTING_MAX_PAGES = 100;
const MODEL_PROVIDER_CATALOG_REFRESH_TIMEOUT_MS = 15_000;
const MODEL_IMAGE_INPUT_TEST_TIMEOUT_MS = 90_000;
const MODEL_IMAGE_INPUT_TEST_CODE = "K7P3";
const MODEL_IMAGE_INPUT_TEST_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAWgAAACMCAIAAADeJaSiAAACBUlEQVR42u3dwY7CIBRA0WL4/1+uOxKDNTUi8OCc1WQ2I2puXo1vms7zPAC+8fAUAMIB/F0uP6WUPB3AB+WTDRMH4FIF6HmpUk8jAMe7zzFMHIBLFUA4AOEAhAMQDgDhAIQDEA5AOADhABAOQDgA4QCEAxAOAOEAhAMQDkA4AOEANpfH/vk7d4Hq+V/XWz2eiHe3iniuVu+NVc9l4gCEAxAOQDgAhAMQDkA4AOEAhANAOADhALrL+xy1517MbLsGPXcxIu4WRXy9xj5mEwcgHIBwAMIBCAcgHADCAQgHIByAcADCAXBhkV2V+b/b7+yYOADhABAOQDgA4QCEAxAOAOEAhAMQDkA4gA0E2FWxhxLr7DvfwyXiuUwcgHAAwgEIByAcAMIBCAcgHIBwAMIBIBxAUwF2Ve58b3/VnY6IOzir7g3Nthcz9nk2cQDCAQgHIByAcADCASAcgHAAwgEIByAcABfyGsdYdZ8FTByAcADCASAcgHAAwgEIByAcAMIBCAcgHEAoeZ+j2mfhl9d9tveqiQNwqQIIB4BwAMIBCAcgHIBwAAgHIByAcABTSuVb8eXr+nYxgJdMVHEwcQAuVQDhAIQDEA5AOACEAxAOQDgA4QCEA0A4AOEAhAMQDkA4AIQDEA5AOADhAIQD2Fyuf1X+ozGAiQMQDmCQ5PZLgIkDEA5gPk9w52oPijxtGwAAAABJRU5ErkJggg==";
const ANTHROPIC_VERSION = "2023-06-01";
const LISTABLE_MODEL_APIS = new Set([
  "anthropic-messages",
  "google-generative-ai",
  "openai-completions",
  "openai-responses",
]);
const CONFIGURABLE_MODEL_APIS = new Set([
  "anthropic-messages",
  "openai-completions",
  "openai-responses",
  "google-generative-ai",
]);
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9._-]*$/u;
const BUILTIN_PROVIDER_MAP = {
  "amazon-bedrock": true,
  "ant-ling": true,
  anthropic: true,
  "azure-openai-responses": true,
  baseten: true,
  cerebras: true,
  "cloudflare-ai-gateway": true,
  "cloudflare-workers-ai": true,
  deepseek: true,
  fireworks: true,
  "github-copilot": true,
  google: true,
  "google-vertex": true,
  groq: true,
  huggingface: true,
  "kimi-coding": true,
  minimax: true,
  "minimax-cn": true,
  mistral: true,
  moonshotai: true,
  "moonshotai-cn": true,
  nvidia: true,
  openai: true,
  "openai-codex": true,
  opencode: true,
  "opencode-go": true,
  openrouter: true,
  "qwen-token-plan": true,
  "qwen-token-plan-cn": true,
  "qwen-token-plan-individual": true,
  radius: true,
  together: true,
  "vercel-ai-gateway": true,
  xai: true,
  xiaomi: true,
  "xiaomi-token-plan-ams": true,
  "xiaomi-token-plan-cn": true,
  "xiaomi-token-plan-sgp": true,
  zai: true,
  "zai-coding-cn": true,
} satisfies Record<KnownProvider, true>;
const BUILTIN_PROVIDER_IDS = new Set(Object.keys(BUILTIN_PROVIDER_MAP));
const BUILTIN_PROVIDERS = builtinProviders();
const BUILTIN_PROVIDER_DEFAULT_BASE_URLS = new Map(
  BUILTIN_PROVIDERS.flatMap((provider) => {
    const baseURL = provider.baseUrl || provider.getModels()[0]?.baseUrl;
    return baseURL ? [[provider.id, baseURL] as const] : [];
  }),
);
const BUILTIN_PROVIDER_DEFAULT_MODELS = new Map(
  BUILTIN_PROVIDERS.map((provider) => [provider.id, provider.getModels()] as const),
);

const EFFORT_NAMES: Record<PiThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Maximum",
};

const DEFAULT_EFFORT_ORDER: readonly PiThinkingLevel[] = [
  "medium",
  "low",
  "high",
  "minimal",
  "xhigh",
  "max",
  "off",
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function explicitlyRejectsImageInput(message: string): boolean {
  const normalized = message.toLowerCase();
  const mentionsImage = /(?:image(?:_url| input)?|input_image|vision|multimodal|modality)/u.test(
    normalized,
  );
  if (!mentionsImage) {
    return /(?:不支持.{0,24}(?:图片|图像|多模态)|(?:图片|图像|多模态).{0,24}不支持)/u.test(message);
  }
  return /(?:unsupported|not supported|does not support|doesn't support|cannot support|can't support|does not accept|doesn't accept|text[- ]only|only supports? text|not allowed|not enabled|(?:image input|image modality|vision).{0,24}unavailable|only supported by|not (?:a )?(?:vision|multimodal)|no (?:available )?(?:endpoint|provider)s? (?:found )?(?:that |with )?.*(?:support|handle|accept))/u.test(
    normalized,
  );
}

function modelImageInputFailure(message: string): TestModelImageInputValue {
  const normalized = message.toLowerCase();
  if (
    /(?:(?:invalid|unsupported|unrecognized) image (?:format|type|data|payload)|image.{0,32}(?:could not be decoded|decode failed|is corrupt|too (?:small|large))|无法(?:解码|读取).{0,12}(?:图片|图像))/u.test(
      normalized,
    )
  ) {
    return { outcome: "inconclusive", reason: "invalid-image" };
  }
  if (
    /(?:(?:unknown|unrecognized|unexpected|unsupported|invalid) (?:parameter|field).{0,64}(?:image|content)|(?:image_url|input_image).{0,48}(?:unknown|unrecognized|unexpected|not permitted)|extra inputs are not permitted|expected (?:a )?(?:string|text).{0,48}content)/u.test(
      normalized,
    )
  ) {
    return { outcome: "inconclusive", reason: "protocol-mismatch" };
  }
  if (explicitlyRejectsImageInput(message)) {
    return { outcome: "unsupported", reason: "provider-rejected-image" };
  }
  if (
    /(?:model (?:was )?(?:not found|unavailable|unknown)|unknown model|invalid model|no such model|no (?:available )?endpoints? found|no available providers?|没有找到.{0,12}模型|模型不存在)/u.test(
      normalized,
    )
  ) {
    return { outcome: "inconclusive", reason: "model-unavailable" };
  }
  if (/(?:content[_ -]?filter|safety|moderation|内容审核|安全策略)/u.test(normalized)) {
    return { outcome: "inconclusive", reason: "safety" };
  }
  if (
    /(?:\b(?:401|403)\b|unauthori[sz]ed|forbidden|authentication|invalid (?:api[ -]?key|token)|api[ -]?key.{0,32}(?:invalid|missing|required)|no api key|provider is not configured|(?:missing|invalid|no) credentials?|未授权|鉴权|认证失败|无效.{0,12}(?:密钥|令牌))/u.test(
      normalized,
    )
  ) {
    return { outcome: "inconclusive", reason: "authentication" };
  }
  if (
    /(?:\b402\b|insufficient (?:credits?|balance|funds)|credit balance|quota (?:exceeded|exhausted)|额度不足|余额不足|配额(?:不足|已用尽))/u.test(
      normalized,
    )
  ) {
    return { outcome: "inconclusive", reason: "quota-exceeded" };
  }
  if (/(?:\b429\b|rate.?limit|too many requests|请求过于频繁|限流)/u.test(normalized)) {
    return { outcome: "inconclusive", reason: "rate-limited" };
  }
  if (/(?:\b408\b|\b504\b|timed? out|timeout|time out|aborted|超时)/u.test(normalized)) {
    return { outcome: "inconclusive", reason: "timeout" };
  }
  if (
    /(?:fetch failed|network(?: error)?|econn|enotfound|socket|connection (?:refused|reset|closed|failed)|dns|tls|certificate|网络|连接失败|无法连接)/u.test(
      normalized,
    )
  ) {
    return { outcome: "inconclusive", reason: "network" };
  }
  if (
    /(?:\b(?:500|502|503)\b|service unavailable|temporarily unavailable|overloaded|服务不可用|过载)/u.test(
      normalized,
    )
  ) {
    return { outcome: "inconclusive", reason: "provider-unavailable" };
  }
  return { outcome: "inconclusive", reason: "provider-error" };
}

function modelImageInputTestResponse(response: AssistantMessage): TestModelImageInputValue {
  if (response.stopReason === "error") {
    return modelImageInputFailure(response.errorMessage ?? "");
  }
  if (response.stopReason === "aborted") {
    return { outcome: "inconclusive", reason: "timeout" };
  }
  const normalized = response.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("")
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]/gu, "");
  return normalized.includes(MODEL_IMAGE_INPUT_TEST_CODE)
    ? { outcome: "supported", reason: "verified" }
    : { outcome: "inconclusive", reason: "unexpected-response" };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function providerAuthMethods(route?: ModelRuntimeProvider) {
  if (!route?.auth) return [];
  return [
    ...(typeof route.auth.oauth?.login === "function"
      ? [
          {
            type: "oauth" as const,
            label:
              route.auth.oauth.loginLabel || route.auth.oauth.name || "Sign in with an account",
            ...(route.auth.oauth.isSubscription === undefined
              ? {}
              : { isSubscription: route.auth.oauth.isSubscription }),
          },
        ]
      : []),
    ...(typeof route.auth.apiKey?.login === "function"
      ? [
          {
            type: "api_key" as const,
            label: route.auth.apiKey.name || "API key",
          },
        ]
      : []),
  ];
}

function loginPrompt(prompt: ModelRuntimeAuthPrompt, id: string) {
  return {
    id,
    type: prompt.type,
    message: prompt.message ?? "",
    ...(prompt.type === "select"
      ? {
          options: (prompt.options ?? []).map((option) => ({
            id: option.id,
            label: option.label,
            ...(option.description ? { description: option.description } : {}),
          })),
        }
      : prompt.placeholder
        ? { placeholder: prompt.placeholder }
        : {}),
  };
}

function loginEvent(event: AuthEvent) {
  switch (event.type) {
    case "info":
      return {
        type: event.type,
        message: event.message,
        ...(event.links
          ? {
              links: event.links.map((link) => ({
                url: link.url,
                ...(link.label ? { label: link.label } : {}),
              })),
            }
          : {}),
      } satisfies ModelProviderLoginValue["events"][number];
    case "auth_url":
      return {
        type: event.type,
        url: event.url,
        ...(event.instructions ? { instructions: event.instructions } : {}),
      } satisfies ModelProviderLoginValue["events"][number];
    case "device_code":
      return {
        type: event.type,
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        ...(event.intervalSeconds === undefined ? {} : { intervalSeconds: event.intervalSeconds }),
        ...(event.expiresInSeconds === undefined
          ? {}
          : { expiresInSeconds: event.expiresInSeconds }),
      } satisfies ModelProviderLoginValue["events"][number];
    case "progress":
      return { type: event.type, message: event.message };
  }
}

interface ConfigurableProviderDirectoryEntry {
  provider: string;
  displayName: string;
  settingsNs: string;
  settingsPath: string[];
  declared?: boolean;
}

function configurableProviderDirectory(
  providers: readonly ModelRuntimeProvider[],
  overrides: ModelServiceOptions["providerSettings"],
): ConfigurableProviderDirectoryEntry[] {
  if (!overrides) return [];
  const routes = new Map(providers.map((provider) => [provider.id, provider]));
  return Object.entries(overrides).map(([provider, configured]) => ({
    provider,
    displayName: configured.displayName || routes.get(provider)?.name || provider,
    settingsNs: configured.settingsNs ?? "",
    settingsPath: [...(configured.settingsPath ?? [])],
    ...(configured.declared === undefined ? {} : { declared: configured.declared }),
  }));
}

function internalProviderIds(
  runtime: ModelRuntimeLike,
  directory: readonly ConfigurableProviderDirectoryEntry[],
): Set<string> {
  return new Set([
    ...BUILTIN_PROVIDER_IDS,
    ...(runtime.getRegisteredProviderIds?.() ?? []),
    ...directory.map(({ provider }) => provider),
  ]);
}

function modelReasoning(model: ModelRuntimeModel): ModelCatalogModel["reasoning"] {
  if (!model.reasoning) return undefined;

  const efforts = PI_THINKING_LEVELS.filter(
    (level) => model.thinkingLevelMap?.[level] !== null,
  ).map((level) => ({ id: level, name: EFFORT_NAMES[level] }));
  if (efforts.length === 0) return undefined;

  const supported = new Set(efforts.map(({ id }) => id));
  const defaultEffort = DEFAULT_EFFORT_ORDER.find((level) => supported.has(level));
  return {
    efforts,
    ...(defaultEffort ? { defaultEffort } : {}),
  };
}

export function toModelCatalogModel(
  model: ModelRuntimeModel,
  imageInput = imageInputCapability(model.input),
  imageInputSource: ModelCatalogModel["imageInputSource"] = model.input === undefined
    ? undefined
    : "runtime",
  contextWindowSource: ModelCatalogModel["contextWindowSource"] = "provider",
): ModelCatalogModel {
  const reasoning = modelReasoning(model);
  return {
    id: model.id,
    name: model.name || model.id,
    input: model.input ?? ["text"],
    imageInput,
    ...(imageInputSource ? { imageInputSource } : {}),
    ...(Number.isInteger(model.contextWindow) && model.contextWindow > 0
      ? { contextWindow: model.contextWindow }
      : {}),
    ...(Number.isInteger(model.maxTokens) && model.maxTokens > 0
      ? { maxTokens: model.maxTokens }
      : {}),
    contextWindowSource,
    ...(reasoning ? { reasoning } : {}),
  };
}

function failure(id: string, name: string, message: string): ModelCatalogFailure {
  return { id, name, message };
}

function uniqueFailures(failures: readonly ModelCatalogFailure[]): ModelCatalogFailure[] {
  const seen = new Set<string>();
  return failures.filter((item) => {
    const key = `${item.id}\u0000${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function discoveryDetails(
  input: DiscoverModelsInput,
  cause?: unknown,
): ModelServiceErrorDetails["model-discovery-failed"] {
  return {
    settingsNs: input.settingsNs,
    ...(input.baseURL ? { baseURL: input.baseURL } : {}),
    reason: cause instanceof EndpointDiscoveryError ? cause.reason : "runtime",
    ...(cause instanceof EndpointDiscoveryError && cause.httpStatus !== undefined
      ? { httpStatus: cause.httpStatus }
      : {}),
  };
}

function discoveryError(input: DiscoverModelsInput, cause?: unknown): ModelServiceError {
  return new ModelServiceError(
    "model-discovery-failed",
    cause instanceof EndpointDiscoveryError ? cause.message : "Model discovery failed.",
    discoveryDetails(input, cause),
    cause === undefined ? undefined : { cause },
  );
}

class EndpointDiscoveryError extends Error {
  readonly reason: ModelDiscoveryFailureReason;
  readonly httpStatus?: number;

  constructor(
    reason: ModelDiscoveryFailureReason,
    message: string,
    options: ErrorOptions & { httpStatus?: number } = {},
  ) {
    super(message, options);
    this.name = "EndpointDiscoveryError";
    this.reason = reason;
    this.httpStatus = options.httpStatus;
  }
}

function modelListingHttpFailureReason(status: number): ModelDiscoveryFailureReason {
  if (status === 401 || status === 403) return "authentication";
  if (status === 404) return "endpoint-not-found";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "provider-unavailable";
  return "http-error";
}

function providerCatalogFailureReason(error: unknown): ModelDiscoveryFailureReason {
  switch (modelImageInputFailure(errorMessage(error)).reason) {
    case "authentication":
      return "authentication";
    case "network":
      return "network";
    case "provider-unavailable":
    case "quota-exceeded":
    case "timeout":
      return "provider-unavailable";
    case "rate-limited":
      return "rate-limited";
    default:
      return "runtime";
  }
}

class ApiKeyInteractionError extends Error {
  constructor() {
    super("The provider requires additional interactive configuration.");
    this.name = "ApiKeyInteractionError";
  }
}

function providerApiKey(raw: string, provider: string): string {
  const apiKey = raw.trim();
  if (!apiKey || !/^[\x21-\x7e]+$/u.test(apiKey)) {
    throw new ModelServiceError("model-provider-configuration-failed", "The API key is invalid.", {
      provider,
    });
  }
  return apiKey;
}

function providerConfigurationFailure(provider: string, message: string, cause?: unknown): never {
  throw new ModelServiceError(
    "model-provider-configuration-failed",
    message,
    { provider },
    cause === undefined ? undefined : { cause },
  );
}

function configuredModel(
  provider: string,
  model: ModelProviderModelConfiguration,
): ModelProviderModelConfiguration {
  const id = model.id.trim();
  if (!id) providerConfigurationFailure(provider, "Every model must have an ID.");
  const name = model.name?.trim();
  for (const [field, value] of [
    ["context window", model.contextWindow],
    ["maximum output tokens", model.maxTokens],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      providerConfigurationFailure(provider, `The model ${field} must be a positive integer.`);
    }
  }
  const input = model.input === undefined ? undefined : [...new Set(model.input)];
  if (input?.length === 0) {
    providerConfigurationFailure(provider, "Every configured model needs an input modality.");
  }
  const thinkingLevelMap = model.thinkingLevelMap ? { ...model.thinkingLevelMap } : undefined;
  return {
    id,
    ...(name ? { name } : {}),
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
    ...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    ...(input ? { input } : {}),
    ...(input && model.imageInputSource ? { imageInputSource: model.imageInputSource } : {}),
  };
}

function providerConfiguration(
  provider: string,
  input: NonNullable<ConfigureModelProviderPayload["configuration"]>,
): NonNullable<ConfigureModelProviderPayload["configuration"]> {
  if (!PROVIDER_ID_PATTERN.test(provider)) {
    providerConfigurationFailure(
      provider,
      "The provider ID must start with a lowercase letter and may only contain lowercase letters, numbers, dots, underscores, and hyphens.",
    );
  }
  let baseURL: URL;
  try {
    baseURL = new URL(input.baseURL.trim());
  } catch (error) {
    providerConfigurationFailure(provider, "The provider API address is invalid.", error);
  }
  if (baseURL.protocol !== "http:" && baseURL.protocol !== "https:") {
    providerConfigurationFailure(provider, "The provider API address must use HTTP or HTTPS.");
  }
  if (!CONFIGURABLE_MODEL_APIS.has(input.api)) {
    providerConfigurationFailure(provider, "The provider API protocol is not supported.");
  }
  if (input.models?.length === 0) {
    providerConfigurationFailure(provider, "Add at least one model to this provider.");
  }
  const models = input.models?.map((model) => configuredModel(provider, model));
  if (models && new Set(models.map(({ id }) => id)).size !== models.length) {
    providerConfigurationFailure(provider, "Model IDs must be unique within a provider.");
  }
  const displayName = input.displayName?.trim();
  return {
    ...(displayName ? { displayName } : {}),
    baseURL: input.baseURL.trim().replace(/\/+$/u, ""),
    api: input.api,
    ...(models ? { models } : {}),
  };
}

function runtimeModelConfiguration(
  model: ModelRuntimeModel,
  contextWindowSource: ModelProviderModelConfiguration["contextWindowSource"] = "provider",
): ModelProviderModelConfiguration {
  return {
    id: model.id,
    ...(model.name && model.name !== model.id ? { name: model.name } : {}),
    ...(Number.isInteger(model.contextWindow) && model.contextWindow > 0
      ? { contextWindow: model.contextWindow }
      : {}),
    contextWindowSource,
    ...(Number.isInteger(model.maxTokens) && model.maxTokens > 0
      ? { maxTokens: model.maxTokens }
      : {}),
    ...(model.reasoning ? { reasoning: true } : {}),
    ...(model.thinkingLevelMap ? { thinkingLevelMap: { ...model.thinkingLevelMap } } : {}),
    ...(model.input ? { input: [...new Set(model.input)] } : {}),
    ...(model.input ? { imageInputSource: "runtime" as const } : {}),
  };
}

interface ModelListingEntry {
  id?: unknown;
  name?: unknown;
  baseModelId?: unknown;
  displayName?: unknown;
  display_name?: unknown;
  inputTokenLimit?: unknown;
  max_input_tokens?: unknown;
  context_window?: unknown;
  context_length?: unknown;
  outputTokenLimit?: unknown;
  max_tokens?: unknown;
  max_output_tokens?: unknown;
  architecture?: unknown;
  capabilities?: unknown;
  input_modalities?: unknown;
  supportedGenerationMethods?: unknown;
}

interface ModelListingPage {
  models: DiscoveredModel[];
  hasMore: boolean;
  lastId?: string;
  nextPageToken?: string;
}

function modelListingUrl(baseURL: string, api: string, cursor?: string): string {
  const normalized = baseURL.replace(/\/+$/u, "");
  if (api === "google-generative-ai") {
    const url = new URL(`${normalized}/models`);
    url.searchParams.set("pageSize", String(MODEL_LISTING_PAGE_LIMIT));
    if (cursor) url.searchParams.set("pageToken", cursor);
    return url.toString();
  }
  if (api !== "anthropic-messages") return `${normalized}/models`;

  const endpoint = normalized.endsWith("/v1") ? `${normalized}/models` : `${normalized}/v1/models`;
  const url = new URL(endpoint);
  url.searchParams.set("limit", String(MODEL_LISTING_PAGE_LIMIT));
  if (cursor) url.searchParams.set("after_id", cursor);
  return url.toString();
}

function listingLabel(...values: readonly unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function listingCapacity(...values: readonly unknown[]): number | undefined {
  return values.find(
    (value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1,
  );
}

function listingRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function listingModalities(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function listingInputCapability(entry: ModelListingEntry): {
  input?: ModelInputModality[];
  imageInput: ModelCapabilityState;
} {
  const capabilities = listingRecord(entry.capabilities);
  const imageInput = listingRecord(capabilities?.image_input)?.supported;
  if (typeof imageInput === "boolean") {
    return {
      input: imageInput ? ["text", "image"] : ["text"],
      imageInput: imageInput ? "supported" : "unsupported",
    };
  }

  const architecture = listingRecord(entry.architecture);
  const modalities =
    listingModalities(architecture?.input_modalities) ?? listingModalities(entry.input_modalities);
  if (modalities === undefined) return { imageInput: "unknown" };

  const input: ModelInputModality[] = [];
  if (modalities.includes("text")) input.push("text");
  if (modalities.includes("image")) input.push("image");
  return {
    ...(input.length > 0 ? { input } : {}),
    imageInput: modalities.includes("image") ? "supported" : "unsupported",
  };
}

function requestApiKey(raw: string): string {
  const key = raw.trim();
  if (!key) {
    throw new EndpointDiscoveryError("invalid-api-key", "The request-scoped API key is blank.");
  }
  if (!/^[\x21-\x7e]+$/u.test(key)) {
    throw new EndpointDiscoveryError(
      "invalid-api-key",
      "The request-scoped API key contains characters that cannot be sent in an HTTP header.",
    );
  }
  return key;
}

async function readBoundedListing(
  response: Response,
  url: string,
  signal?: AbortSignal,
  limit = MODEL_LISTING_RESPONSE_LIMIT,
): Promise<string> {
  signal?.throwIfAborted();
  const oversized = () =>
    new EndpointDiscoveryError(
      "invalid-response",
      `${url} answered with more than ${MODEL_LISTING_RESPONSE_LIMIT} bytes.`,
    );
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (limit <= 0 || (Number.isFinite(declared) && declared > limit)) {
    void response.body?.cancel().catch(() => undefined);
    throw oversized();
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const handleAbort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
    rejectAbort?.(
      signal?.reason ?? new DOMException("The model listing request was aborted.", "AbortError"),
    );
  };
  signal?.addEventListener("abort", handleAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await (signal
        ? Promise.race([reader.read(), aborted])
        : reader.read());
      signal?.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw oversized();
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", handleAbort);
    void reader.cancel().catch(() => undefined);
  }

  signal?.throwIfAborted();

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function parseModelListing(body: unknown): ModelListingPage {
  const record = typeof body === "object" && body !== null ? body : undefined;
  const data = record && "data" in record ? (record as { data: unknown }).data : undefined;
  if (!Array.isArray(data)) {
    throw new EndpointDiscoveryError(
      "invalid-response",
      'The endpoint model listing has no "data" array; enter this provider\'s models manually.',
    );
  }

  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const raw of data) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as ModelListingEntry;
    const id = listingLabel(entry.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = listingLabel(entry.name, entry.display_name);
    const contextWindow = listingCapacity(
      entry.max_input_tokens,
      entry.context_window,
      entry.context_length,
    );
    const maxTokens = listingCapacity(entry.max_output_tokens, entry.max_tokens);
    const capability = listingInputCapability(entry);
    models.push({
      id,
      ...(name ? { name } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
      ...(capability.input ? { input: capability.input } : {}),
      imageInput: capability.imageInput,
      ...(capability.imageInput === "unknown" ? {} : { imageInputSource: "provider-api" as const }),
    });
  }
  return {
    models,
    hasMore: record !== undefined && "has_more" in record && record.has_more === true,
    ...(record !== undefined && "last_id" in record
      ? { lastId: listingLabel(record.last_id) }
      : {}),
  };
}

function googleModelResourceId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.startsWith("models/") ? value.slice("models/".length) : value;
  return id || undefined;
}

function parseGoogleModelListing(body: unknown): ModelListingPage {
  const record = listingRecord(body);
  const data = record?.models;
  if (!Array.isArray(data)) {
    throw new EndpointDiscoveryError(
      "invalid-response",
      'The Google model listing has no "models" array; enter this provider\'s models manually.',
    );
  }

  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const raw of data) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as ModelListingEntry;
    const generationMethods = listingModalities(entry.supportedGenerationMethods);
    if (generationMethods && !generationMethods.includes("generateContent")) continue;
    const id = listingLabel(entry.baseModelId, googleModelResourceId(entry.name));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = listingLabel(entry.displayName);
    const contextWindow = listingCapacity(entry.inputTokenLimit);
    const maxTokens = listingCapacity(entry.outputTokenLimit);
    models.push({
      id,
      ...(name ? { name } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
      imageInput: "unknown",
    });
  }

  return {
    models,
    hasMore: false,
    ...(typeof record?.nextPageToken === "string" && record.nextPageToken
      ? { nextPageToken: record.nextPageToken }
      : {}),
  };
}

function discoveredModel(model: ModelRuntimeModel): DiscoveredModel {
  return {
    id: model.id,
    ...(model.name && model.name !== model.id ? { name: model.name } : {}),
    ...(Number.isInteger(model.contextWindow) && model.contextWindow >= 1
      ? { contextWindow: model.contextWindow }
      : {}),
    ...(Number.isInteger(model.maxTokens) && model.maxTokens >= 1
      ? { maxTokens: model.maxTokens }
      : {}),
    ...(model.reasoning ? { reasoning: true } : {}),
    ...(model.thinkingLevelMap ? { thinkingLevelMap: { ...model.thinkingLevelMap } } : {}),
    ...(model.input ? { input: [...new Set(model.input)] } : {}),
    imageInput: imageInputCapability(model.input),
    ...(model.input ? { imageInputSource: "runtime" as const } : {}),
  };
}

export class ModelService implements ModelProviderProtocol, ModelContextWindowProtocol {
  private readonly cwd: string;
  private readonly serviceFactory: ModelServiceFactory;
  private readonly injectedRuntime?: ModelRuntimeLike;
  private readonly fetcher: typeof fetch;
  private readonly settingsOverrides?: ModelServiceOptions["providerSettings"];
  private readonly modelConfigStore: ModelConfigStorage;
  private readonly providerLogins = new Map<string, ModelProviderLoginSession>();
  private loaded?: Promise<LoadedModelServices>;

  constructor(options: ModelServiceOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.serviceFactory = options.serviceFactory ?? createAgentSessionServices;
    this.injectedRuntime = options.runtime;
    this.fetcher = options.fetcher ?? fetch;
    this.settingsOverrides = options.providerSettings;
    this.modelConfigStore = options.modelConfigStore ?? new ModelConfigStore();
  }

  private async load(): Promise<LoadedModelServices> {
    if (this.injectedRuntime) return { runtime: this.injectedRuntime, diagnostics: [] };

    const load = async (): Promise<LoadedModelServices> => {
      const services = await this.serviceFactory({
        cwd: this.cwd,
        resourceLoaderReloadOptions: {
          resolveProjectTrust: async () => getProjectTrustService().isTrusted(this.cwd),
        },
      });
      return {
        runtime: services.modelRuntime,
        diagnostics: services.diagnostics ?? [],
      };
    };

    this.loaded ??= load();
    return this.loaded;
  }

  async providers(): Promise<ModelProvidersResult> {
    const { runtime } = await this.load();
    // AuthStorage notices external auth.json revisions when it is read. Refresh
    // the runtime's derived availability/status snapshot so account logins made
    // in Pi TUI become visible without restarting Workbench.
    await runtime.getAvailable();
    const storedConfigurations = await this.modelConfigStore.providers();
    // Pi's provider registry is the route authority. Authentication is a
    // separate concern: a registered route remains active while its credential
    // is absent or being edited.
    const registered = runtime.getProviders();
    const active = new Set(registered.map((provider) => provider.id));
    const routes = new Map(registered.map((provider) => [provider.id, provider]));
    const directory = configurableProviderDirectory(registered, this.settingsOverrides);
    const declared = new Set(directory.map((entry) => entry.provider));
    const internal = internalProviderIds(runtime, directory);
    const providers: ConfigurableProviderView[] = directory.map((entry) => {
      const route = routes.get(entry.provider);
      const status = route ? runtime.getProviderAuthStatus?.(entry.provider) : undefined;
      const builtIn = internal.has(entry.provider);
      const usingOAuth = status?.configured ? runtime.isUsingOAuth?.(entry.provider) : undefined;
      const authMethods = providerAuthMethods(route);
      return {
        provider: entry.provider,
        displayName: entry.displayName,
        kind: builtIn ? "built-in" : "custom",
        settingsNs: entry.settingsNs,
        settingsPath: [...entry.settingsPath],
        active: active.has(entry.provider),
        ...(entry.declared === undefined ? {} : { declared: entry.declared }),
        configured: status?.configured ?? false,
        ...(status?.source ? { authSource: status.source } : {}),
        ...(usingOAuth === undefined ? {} : { authType: usingOAuth ? "oauth" : "api_key" }),
        ...(authMethods.length > 0 ? { authMethods } : {}),
        apiKeyConfigurable: typeof route?.auth?.apiKey?.login === "function",
        removable:
          entry.provider in storedConfigurations ||
          status?.source === "stored" ||
          status?.source === "runtime",
        configurationDefined: entry.provider in storedConfigurations,
      };
    });

    // A live route without a configurable-directory declaration is still
    // visible, but it must not advertise a made-up settings address.
    for (const route of registered) {
      if (declared.has(route.id)) continue;
      const status = runtime.getProviderAuthStatus?.(route.id);
      const builtIn = internal.has(route.id);
      const usingOAuth = status?.configured ? runtime.isUsingOAuth?.(route.id) : undefined;
      const authMethods = providerAuthMethods(route);
      providers.push({
        provider: route.id,
        displayName: route.name || route.id,
        kind: builtIn ? "built-in" : "custom",
        settingsNs: "",
        settingsPath: [],
        active: true,
        configured: status?.configured ?? false,
        ...(status?.source ? { authSource: status.source } : {}),
        ...(usingOAuth === undefined ? {} : { authType: usingOAuth ? "oauth" : "api_key" }),
        ...(authMethods.length > 0 ? { authMethods } : {}),
        apiKeyConfigurable: typeof route.auth?.apiKey?.login === "function",
        removable:
          route.id in storedConfigurations ||
          status?.source === "stored" ||
          status?.source === "runtime",
        configurationDefined: route.id in storedConfigurations,
      });
    }

    return {
      providers: providers.sort((left, right) => compareText(left.provider, right.provider)),
    };
  }

  async providerConfig(input: { provider: string }): Promise<ModelProviderConfigValue> {
    const { runtime } = await this.load();
    const stored = (await this.modelConfigStore.providers())[input.provider];
    const route = runtime.getProviders().find(({ id }) => id === input.provider);
    if (!route && !stored) {
      throw new ModelServiceError(
        "model-provider-not-found",
        "The model provider does not exist.",
        { provider: input.provider },
      );
    }
    const runtimeModels = runtime.getModels(input.provider);
    const hasModelCustomizations =
      stored?.models !== undefined ||
      (stored?.modelOverrides !== undefined && Object.keys(stored.modelOverrides).length > 0);
    const builtinDefaultModels = BUILTIN_PROVIDER_DEFAULT_MODELS.get(input.provider);
    // The live runtime catalog is composed with stored model values. Once it is customized,
    // use the generated built-in catalog as the restore baseline. Purely dynamic built-ins
    // have no generated models, so their provider-owned runtime catalog remains authoritative.
    const adapterRuntimeModels =
      !hasModelCustomizations || builtinDefaultModels?.length === 0
        ? runtimeModels
        : (builtinDefaultModels ?? []);
    const firstModel = runtimeModels[0];
    const defaultBaseURL =
      BUILTIN_PROVIDER_DEFAULT_BASE_URLS.get(input.provider) ||
      (stored ? undefined : route?.baseUrl || firstModel?.baseUrl);
    const configuredBaseURL =
      stored?.baseURL && stored.baseURL !== defaultBaseURL ? stored.baseURL : undefined;
    return {
      provider: input.provider,
      displayName: stored?.displayName || route?.name || input.provider,
      ...(defaultBaseURL ? { defaultBaseURL } : {}),
      ...(configuredBaseURL ? { baseURL: configuredBaseURL } : {}),
      ...(stored?.api || firstModel?.api ? { api: stored?.api || firstModel?.api } : {}),
      configurationDefined: stored !== undefined,
      modelsSource: stored?.models ? "custom" : "adapter",
      adapterModels: adapterRuntimeModels.map((model) =>
        runtimeModelConfiguration(model, "provider"),
      ),
      models:
        stored?.models?.map((model) => ({ ...model, contextWindowSource: "custom" as const })) ??
        runtimeModels.map((model) =>
          runtimeModelConfiguration(
            model,
            stored?.modelOverrides?.[model.id]?.contextWindow === undefined
              ? "provider"
              : "override",
          ),
        ),
    };
  }

  private providerLoginSnapshot(session: ModelProviderLoginSession): ModelProviderLoginValue {
    return structuredClone(session.value);
  }

  private providerLoginSession(loginId: string): ModelProviderLoginSession {
    const session = this.providerLogins.get(loginId);
    if (!session) {
      throw new ModelServiceError(
        "model-provider-login-not-found",
        "The provider login session does not exist.",
        { loginId },
      );
    }
    return session;
  }

  private finishProviderLogin(
    session: ModelProviderLoginSession,
    status: Exclude<ModelProviderLoginValue["status"], "running">,
  ): void {
    if (session.value.status !== "running") return;
    session.value.status = status;
    session.value.revision += 1;
    delete session.value.prompt;
    session.answerPrompt = undefined;
    session.rejectPrompt = undefined;
    const timer = setTimeout(() => {
      if (this.providerLogins.get(session.value.loginId) === session) {
        this.providerLogins.delete(session.value.loginId);
      }
    }, 5 * 60_000);
    timer.unref?.();
  }

  private promptProviderLogin(
    session: ModelProviderLoginSession,
    prompt: ModelRuntimeAuthPrompt,
  ): Promise<string> {
    if (session.value.status !== "running") {
      return Promise.reject(new DOMException("Provider login was cancelled.", "AbortError"));
    }
    const promptId = globalThis.crypto.randomUUID();
    session.value.prompt = loginPrompt(prompt, promptId);
    session.value.revision += 1;

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        session.controller.signal.removeEventListener("abort", handleLoginAbort);
        prompt.signal?.removeEventListener("abort", handlePromptAbort);
        if (session.value.prompt?.id === promptId) delete session.value.prompt;
        if (session.answerPrompt === answer) session.answerPrompt = undefined;
        if (session.rejectPrompt === rejectPrompt) session.rejectPrompt = undefined;
        session.value.revision += 1;
      };
      const answer = (value: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const rejectPrompt = (reason: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(reason);
      };
      const handleLoginAbort = () =>
        rejectPrompt(
          session.controller.signal.reason ??
            new DOMException("Provider login was cancelled.", "AbortError"),
        );
      const handlePromptAbort = () =>
        rejectPrompt(
          prompt.signal?.reason ??
            new DOMException("Provider login prompt was cancelled.", "AbortError"),
        );

      session.answerPrompt = answer;
      session.rejectPrompt = rejectPrompt;
      session.controller.signal.addEventListener("abort", handleLoginAbort, { once: true });
      prompt.signal?.addEventListener("abort", handlePromptAbort, { once: true });
      if (session.controller.signal.aborted) handleLoginAbort();
      else if (prompt.signal?.aborted) handlePromptAbort();
    });
  }

  private notifyProviderLogin(session: ModelProviderLoginSession, event: AuthEvent): void {
    if (session.value.status !== "running") return;
    const next = loginEvent(event);
    const previous = session.value.events.at(-1);
    if (next.type === "progress" && previous?.type === "progress") {
      session.value.events[session.value.events.length - 1] = next;
    } else {
      session.value.events.push(next);
      if (session.value.events.length > 32) session.value.events.shift();
    }
    session.value.revision += 1;
  }

  private async runProviderLogin(
    session: ModelProviderLoginSession,
    runtime: ModelRuntimeLike,
  ): Promise<void> {
    try {
      await runtime.login!(session.value.provider, session.value.authType, {
        signal: session.controller.signal,
        prompt: (prompt) => this.promptProviderLogin(session, prompt),
        notify: (event) => this.notifyProviderLogin(session, event),
      });
      // Account login and model discovery are separate Pi operations. Refresh the
      // provider-owned dynamic catalog now so the settings page can use the runtime
      // snapshot immediately; a catalog failure must not roll back valid credentials.
      const catalogSignal = AbortSignal.any([
        session.controller.signal,
        AbortSignal.timeout(MODEL_PROVIDER_CATALOG_REFRESH_TIMEOUT_MS),
      ]);
      await runtime
        .refresh({
          allowNetwork: true,
          providers: [session.value.provider],
          signal: catalogSignal,
        })
        .catch(() => undefined);
      session.controller.signal.throwIfAborted();
      await runtime.getAvailable(session.value.provider).catch(() => undefined);
      this.finishProviderLogin(session, "complete");
    } catch (error) {
      if (session.value.status !== "running") return;
      this.finishProviderLogin(
        session,
        session.controller.signal.aborted || (error instanceof Error && error.name === "AbortError")
          ? "cancelled"
          : "failed",
      );
    }
  }

  async startProviderLogin(
    input: StartModelProviderLoginPayload,
  ): Promise<ModelProviderLoginValue> {
    const { runtime } = await this.load();
    const route = runtime.getProviders().find(({ id }) => id === input.provider);
    if (!route) {
      throw new ModelServiceError(
        "model-provider-not-found",
        "The model provider does not exist.",
        { provider: input.provider },
      );
    }
    if (typeof route.auth?.oauth?.login !== "function" || !runtime.login) {
      throw new ModelServiceError(
        "model-provider-account-login-unsupported",
        "This provider does not support account login.",
        { provider: input.provider },
      );
    }
    if (
      [...this.providerLogins.values()].some(
        (session) =>
          session.value.provider === input.provider && session.value.status === "running",
      )
    ) {
      throw new ModelServiceError(
        "model-provider-login-in-progress",
        "An account login is already in progress for this provider.",
        { provider: input.provider },
      );
    }

    const loginId = globalThis.crypto.randomUUID();
    const session: ModelProviderLoginSession = {
      controller: new AbortController(),
      value: {
        loginId,
        provider: input.provider,
        authType: input.authType,
        status: "running",
        revision: 0,
        events: [],
      },
    };
    this.providerLogins.set(loginId, session);
    void this.runProviderLogin(session, runtime);
    return this.providerLoginSnapshot(session);
  }

  providerLogin(input: ModelProviderLoginPayload): ModelProviderLoginValue {
    return this.providerLoginSnapshot(this.providerLoginSession(input.loginId));
  }

  respondProviderLogin(input: RespondModelProviderLoginPayload): ModelProviderLoginValue {
    const session = this.providerLoginSession(input.loginId);
    if (
      session.value.status !== "running" ||
      session.value.prompt?.id !== input.promptId ||
      !session.answerPrompt
    ) {
      throw new ModelServiceError(
        "model-provider-login-prompt-mismatch",
        "The provider login prompt is no longer pending.",
        { loginId: input.loginId },
      );
    }
    session.answerPrompt(input.value);
    return this.providerLoginSnapshot(session);
  }

  cancelProviderLogin(input: ModelProviderLoginPayload): ModelProviderLoginValue {
    const session = this.providerLoginSession(input.loginId);
    if (session.value.status === "running") {
      this.finishProviderLogin(session, "cancelled");
      session.controller.abort(new DOMException("Provider login was cancelled.", "AbortError"));
    }
    return this.providerLoginSnapshot(session);
  }

  private async refreshProvider(
    runtime: ModelRuntimeLike,
    provider: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const result = await runtime.refresh({
      allowNetwork: false,
      providers: [provider],
      ...(signal ? { signal } : {}),
    });
    signal?.throwIfAborted();
    if (result.aborted) throw new DOMException("Provider refresh was aborted.", "AbortError");
    const error = result.errors.get(provider);
    if (error) providerConfigurationFailure(provider, "The provider could not be loaded.", error);
  }

  private async loginProvider(
    runtime: ModelRuntimeLike,
    provider: string,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const route = runtime.getProviders().find(({ id }) => id === provider);
    if (!route) {
      throw new ModelServiceError(
        "model-provider-not-found",
        "The model provider does not exist.",
        { provider },
      );
    }
    if (typeof route.auth?.apiKey?.login !== "function" || !runtime.login) {
      throw new ModelServiceError(
        "model-provider-api-key-unsupported",
        "This provider cannot be configured with a single API key.",
        { provider },
      );
    }

    const key = providerApiKey(apiKey, provider);
    let promptCount = 0;
    await runtime.login(provider, "api_key", {
      ...(signal ? { signal } : {}),
      prompt: async (prompt) => {
        signal?.throwIfAborted();
        prompt.signal?.throwIfAborted();
        promptCount += 1;
        if (promptCount !== 1 || (prompt.type !== "secret" && prompt.type !== "text")) {
          throw new ApiKeyInteractionError();
        }
        return key;
      },
      notify() {},
    });
    signal?.throwIfAborted();
  }

  async configureProvider(
    input: ConfigureModelProviderPayload,
    options: { signal?: AbortSignal } = {},
  ): Promise<ModelProvidersResult> {
    const { signal } = options;
    signal?.throwIfAborted();
    const { runtime } = await this.load();
    if (input.apiKey === undefined && input.configuration === undefined) {
      providerConfigurationFailure(input.provider, "The provider configuration is empty.");
    }
    let mutation: ModelConfigMutation | undefined;
    try {
      if (input.configuration) {
        mutation = await this.modelConfigStore.setProvider(
          input.provider,
          providerConfiguration(input.provider, input.configuration),
        );
        await this.refreshProvider(runtime, input.provider, signal);
      }
      if (input.apiKey !== undefined) {
        await this.loginProvider(runtime, input.provider, input.apiKey, signal);
      } else if (!runtime.getProviders().some(({ id }) => id === input.provider)) {
        throw new ModelServiceError(
          "model-provider-not-found",
          "The model provider does not exist.",
          { provider: input.provider },
        );
      }
    } catch (error) {
      if (mutation) {
        await mutation.rollback().catch(() => undefined);
        await this.refreshProvider(runtime, input.provider).catch(() => undefined);
      }
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      if (error instanceof ApiKeyInteractionError) {
        throw new ModelServiceError(
          "model-provider-api-key-unsupported",
          error.message,
          { provider: input.provider },
          { cause: error },
        );
      }
      if (error instanceof ModelServiceError) throw error;
      throw new ModelServiceError(
        "model-provider-configuration-failed",
        "The model provider configuration could not be saved.",
        { provider: input.provider },
        { cause: error },
      );
    }

    return this.providers();
  }

  async modelContextWindow(input: ModelContextWindowPayload): Promise<ModelContextWindowValue> {
    const { runtime } = await this.load();
    const model = runtime
      .getModels(input.provider)
      .find((candidate) => candidate.id === input.model);
    if (!model) {
      throw new ModelServiceError("model-not-found", "The model does not exist.", input);
    }
    const stored = (await this.modelConfigStore.providers())[input.provider];
    const source = stored?.models?.some(({ id }) => id === input.model)
      ? "custom"
      : stored?.modelOverrides?.[input.model]?.contextWindow === undefined
        ? "provider"
        : "override";
    return {
      provider: model.provider,
      model: model.id,
      name: model.name || model.id,
      contextWindow: model.contextWindow,
      source,
    };
  }

  async updateModelContextWindow(
    input: UpdateModelContextWindowPayload,
    options: { signal?: AbortSignal } = {},
  ): Promise<ModelContextWindowValue> {
    const { signal } = options;
    signal?.throwIfAborted();
    if (!Number.isInteger(input.contextWindow) || input.contextWindow < 1) {
      throw new ModelServiceError(
        "model-provider-configuration-failed",
        "The model context window must be a positive integer.",
        { provider: input.provider },
      );
    }
    const current = await this.modelContextWindow(input);
    const { runtime } = await this.load();
    let mutation: ModelConfigMutation | undefined;
    try {
      mutation = await this.modelConfigStore.setModelContextWindow(
        input.provider,
        input.model,
        input.contextWindow,
      );
      await this.refreshProvider(runtime, input.provider, signal);
      return { ...current, contextWindow: input.contextWindow, source: "override" };
    } catch (error) {
      if (mutation) {
        await mutation.rollback().catch(() => undefined);
        await this.refreshProvider(runtime, input.provider).catch(() => undefined);
      }
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      if (error instanceof ModelServiceError) throw error;
      throw new ModelServiceError(
        "model-provider-configuration-failed",
        "The model context window could not be saved.",
        { provider: input.provider },
        { cause: error },
      );
    }
  }

  async resetModelContextWindow(
    input: ModelContextWindowPayload,
    options: { signal?: AbortSignal } = {},
  ): Promise<ModelContextWindowValue> {
    const { signal } = options;
    signal?.throwIfAborted();
    await this.modelContextWindow(input);
    const { runtime } = await this.load();
    let mutation: ModelConfigMutation | undefined;
    try {
      mutation = await this.modelConfigStore.resetModelContextWindow(input.provider, input.model);
      if (mutation) await this.refreshProvider(runtime, input.provider, signal);
      return this.modelContextWindow(input);
    } catch (error) {
      if (mutation) {
        await mutation.rollback().catch(() => undefined);
        await this.refreshProvider(runtime, input.provider).catch(() => undefined);
      }
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      if (error instanceof ModelServiceError) throw error;
      throw new ModelServiceError(
        "model-provider-configuration-failed",
        "The model context-window override could not be reset.",
        { provider: input.provider },
        { cause: error },
      );
    }
  }

  async removeProvider(
    input: { provider: string },
    options: { signal?: AbortSignal } = {},
  ): Promise<ModelProvidersResult> {
    const { signal } = options;
    signal?.throwIfAborted();
    const { runtime } = await this.load();
    const stored = (await this.modelConfigStore.providers())[input.provider];
    const route = runtime.getProviders().find(({ id }) => id === input.provider);
    if (!route && !stored) {
      throw new ModelServiceError(
        "model-provider-not-found",
        "The model provider does not exist.",
        { provider: input.provider },
      );
    }

    const status = runtime.getProviderAuthStatus?.(input.provider);
    const canRemoveAuth = status?.source === "stored" || status?.source === "runtime";
    if (!stored && !canRemoveAuth) {
      throw new ModelServiceError(
        "model-provider-configuration-readonly",
        "This provider is configured outside Workbench and cannot be removed here.",
        { provider: input.provider },
      );
    }

    let mutation: ModelConfigMutation | undefined;
    try {
      mutation = await this.modelConfigStore.removeProvider(input.provider);
      if (canRemoveAuth) {
        if (!runtime.logout) {
          throw new ModelServiceError(
            "model-provider-configuration-readonly",
            "This provider credential cannot be removed here.",
            { provider: input.provider },
          );
        }
        await runtime.logout(input.provider, signal ? { signal } : undefined);
      }
      if (mutation) await this.refreshProvider(runtime, input.provider, signal);
      signal?.throwIfAborted();
    } catch (error) {
      if (mutation) {
        await mutation.rollback().catch(() => undefined);
        await this.refreshProvider(runtime, input.provider).catch(() => undefined);
      }
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      if (error instanceof ModelServiceError) throw error;
      throw new ModelServiceError(
        "model-provider-configuration-failed",
        "The model provider configuration could not be removed.",
        { provider: input.provider },
        { cause: error },
      );
    }

    return this.providers();
  }

  async testModelImageInput(
    input: TestModelImageInputPayload,
    options: { signal?: AbortSignal } = {},
  ): Promise<TestModelImageInputValue> {
    const { signal } = options;
    signal?.throwIfAborted();
    const { runtime } = await this.load();
    if (!runtime.getModel || !runtime.complete) {
      return { outcome: "inconclusive", reason: "runtime-unavailable" };
    }
    const model = runtime.getModel(input.provider, input.model);
    if (!model) return { outcome: "inconclusive", reason: "model-not-found" };

    // Unknown models default to text-only metadata in Pi. Force image admission
    // only for this probe so the provider adapter receives the image and can
    // give us real evidence; the configured model is never mutated here.
    const testModel: Model<Api> = {
      ...model,
      reasoning: false,
      input: ["text", "image"],
      samplingParams: undefined,
    };
    const controller = new AbortController();
    const forwardAbort = () =>
      controller.abort(
        signal?.reason ?? new DOMException("Model image-input test was cancelled.", "AbortError"),
      );
    signal?.addEventListener("abort", forwardAbort, { once: true });
    if (signal?.aborted) forwardAbort();
    const timeout = setTimeout(
      () => controller.abort(new DOMException("Model image-input test timed out.", "TimeoutError")),
      MODEL_IMAGE_INPUT_TEST_TIMEOUT_MS,
    );
    timeout.unref?.();

    try {
      const response = await runtime.complete(
        testModel,
        {
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Read the four-character code in this image. Reply with only the code.",
                },
                {
                  type: "image",
                  data: MODEL_IMAGE_INPUT_TEST_PNG,
                  mimeType: "image/png",
                },
              ],
              timestamp: Date.now(),
            },
          ],
        },
        {
          signal: controller.signal,
          maxRetries: 0,
          timeoutMs: MODEL_IMAGE_INPUT_TEST_TIMEOUT_MS,
        },
      );
      signal?.throwIfAborted();
      return modelImageInputTestResponse(response);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (controller.signal.aborted) return { outcome: "inconclusive", reason: "timeout" };
      return modelImageInputFailure(errorMessage(error));
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", forwardAbort);
    }
  }

  async models(): Promise<ModelCatalogResult> {
    let loaded: LoadedModelServices;
    try {
      loaded = await this.load();
    } catch (error) {
      return {
        groups: [],
        failures: [failure(RUNTIME_FAILURE_ID, RUNTIME_FAILURE_NAME, errorMessage(error))],
      };
    }

    const { runtime, diagnostics } = loaded;
    const providers = runtime.getProviders();
    const storedProviders: Record<string, StoredModelProviderConfiguration> =
      await this.modelConfigStore.providers().catch(() => ({}));
    const entries = await Promise.all(
      providers.map(async (provider) => {
        try {
          const models = await runtime.getAvailable(provider.id);
          const storedModels = new Map(
            storedProviders[provider.id]?.models?.map((model) => [model.id, model] as const) ?? [],
          );
          const modelOverrides = storedProviders[provider.id]?.modelOverrides;
          return {
            group: {
              id: provider.id,
              name: provider.name || provider.id,
              models: [...models]
                .sort((left, right) => compareText(left.id, right.id))
                .map((model) => {
                  const storedModel = storedModels.get(model.id);
                  return storedModel
                    ? toModelCatalogModel(
                        model,
                        storedModel.imageInputSource
                          ? imageInputCapability(storedModel.input)
                          : "unknown",
                        storedModel.imageInputSource,
                        "custom",
                      )
                    : toModelCatalogModel(
                        model,
                        imageInputCapability(model.input),
                        model.input === undefined ? undefined : "runtime",
                        modelOverrides?.[model.id]?.contextWindow === undefined
                          ? "provider"
                          : "override",
                      );
                }),
            } satisfies ModelProviderGroup,
          };
        } catch (error) {
          return {
            failure: failure(provider.id, provider.name || provider.id, errorMessage(error)),
          };
        }
      }),
    );

    const groups = entries
      .flatMap((entry) => (entry.group && entry.group.models.length > 0 ? [entry.group] : []))
      .sort((left, right) => compareText(left.id, right.id));
    const failures = entries.flatMap((entry) => (entry.failure ? [entry.failure] : []));
    for (const diagnostic of diagnostics) {
      if (diagnostic.type === "error") {
        failures.push(failure(RUNTIME_FAILURE_ID, RUNTIME_FAILURE_NAME, diagnostic.message));
      }
    }
    const runtimeError = runtime.getError?.();
    if (runtimeError) {
      failures.push(failure(RUNTIME_FAILURE_ID, RUNTIME_FAILURE_NAME, runtimeError));
    }

    return { groups, failures: uniqueFailures(failures) };
  }

  private discoveryProvider(
    input: DiscoverModelsInput,
    runtime: ModelRuntimeLike,
  ): string | undefined {
    const providers = runtime.getProviders();
    const directory = configurableProviderDirectory(providers, this.settingsOverrides);
    if (input.provider) {
      return providers.some(({ id }) => id === input.provider) ||
        directory.some((entry) => entry.provider === input.provider)
        ? input.provider
        : undefined;
    }

    const matches = directory.filter((entry) => entry.settingsNs === input.settingsNs);
    return matches.length === 1 ? matches[0].provider : undefined;
  }

  async discoverModels(
    input: DiscoverModelsInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<DiscoverModelsResult> {
    const { signal } = options;
    signal?.throwIfAborted();
    let runtime: ModelRuntimeLike | undefined;
    try {
      runtime = (await this.load()).runtime;
      signal?.throwIfAborted();
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      if (!input.baseURL) throw discoveryError(input, error);
    }

    const provider = runtime ? this.discoveryProvider(input, runtime) : undefined;
    if (input.source === "provider") {
      if (!runtime || !provider) {
        throw discoveryError(
          input,
          new EndpointDiscoveryError(
            "runtime",
            "The provider-owned model catalog is not available.",
          ),
        );
      }

      try {
        if (runtime.getProviderAuthStatus?.(provider).configured === false) {
          throw new EndpointDiscoveryError(
            "authentication",
            "The provider account is not configured.",
          );
        }
        if (runtime.getAuth && !(await runtime.getAuth(provider, { signal }))) {
          throw new EndpointDiscoveryError(
            "authentication",
            "The provider account could not be resolved.",
          );
        }
        signal?.throwIfAborted();
        const refresh = await runtime.refresh({
          allowNetwork: true,
          providers: [provider],
          ...(signal ? { signal } : {}),
        });
        signal?.throwIfAborted();
        if (refresh.aborted) {
          throw new DOMException("Provider model refresh was aborted.", "AbortError");
        }
        const refreshError = refresh.errors.get(provider);
        if (refreshError) {
          throw new EndpointDiscoveryError(
            providerCatalogFailureReason(refreshError),
            "The provider-owned model catalog could not be refreshed.",
            { cause: refreshError },
          );
        }
        const catalog = await runtime.getAvailable(provider);
        signal?.throwIfAborted();
        return {
          models: [...catalog]
            .sort((left, right) => compareText(left.id, right.id))
            .map(discoveredModel),
        };
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
        throw discoveryError(
          input,
          error instanceof EndpointDiscoveryError
            ? error
            : new EndpointDiscoveryError(
                providerCatalogFailureReason(error),
                "The provider-owned model catalog could not be loaded.",
                { cause: error },
              ),
        );
      }
    }

    if (provider && input.source !== "endpoint") {
      const catalog = runtime?.getModels(provider) ?? [];
      if (catalog.length > 0) {
        return {
          models: [...catalog]
            .sort((left, right) => compareText(left.id, right.id))
            .map(discoveredModel),
        };
      }
    }

    if (!input.baseURL) {
      throw discoveryError(
        input,
        new EndpointDiscoveryError(
          "missing-api-address",
          "The provider API address is required for endpoint discovery.",
        ),
      );
    }

    const api = input.api ?? "openai-completions";
    if (!LISTABLE_MODEL_APIS.has(api)) {
      throw discoveryError(
        input,
        new EndpointDiscoveryError(
          "unsupported-protocol",
          `Pi API protocol "${api}" has no model listing this build can read; enter this provider's models manually.`,
        ),
      );
    }

    let url = input.baseURL;
    try {
      signal?.throwIfAborted();
      const resolvedApiKey =
        input.apiKey === undefined && provider
          ? (await runtime?.getAuth?.(provider, { signal }))?.auth.apiKey
          : input.apiKey;
      signal?.throwIfAborted();
      const apiKey = resolvedApiKey === undefined ? undefined : requestApiKey(resolvedApiKey);
      const headers = {
        accept: "application/json",
        ...(api === "anthropic-messages"
          ? {
              "anthropic-version": ANTHROPIC_VERSION,
              ...(apiKey ? { "x-api-key": apiKey } : {}),
            }
          : api === "google-generative-ai"
            ? apiKey
              ? { "x-goog-api-key": apiKey }
              : {}
            : apiKey
              ? { authorization: `Bearer ${apiKey}` }
              : {}),
      };
      const models: DiscoveredModel[] = [];
      const seenModelIds = new Set<string>();
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      let remainingBytes = MODEL_LISTING_RESPONSE_LIMIT;

      for (let pageIndex = 0; pageIndex < MODEL_LISTING_MAX_PAGES; pageIndex += 1) {
        url = modelListingUrl(input.baseURL, api, cursor);
        const response = await this.fetcher(url, {
          method: "GET",
          headers,
          ...(signal ? { signal } : {}),
        });
        signal?.throwIfAborted();
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          throw new EndpointDiscoveryError(
            modelListingHttpFailureReason(response.status),
            `${url} answered ${response.status}${
              response.status === 401 || response.status === 403 ? "; check the API key" : ""
            }.`,
            { httpStatus: response.status },
          );
        }

        const text = await readBoundedListing(response, url, signal, remainingBytes);
        remainingBytes -= new TextEncoder().encode(text).byteLength;
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch (error) {
          throw new EndpointDiscoveryError("invalid-response", `${url} did not answer with JSON.`, {
            cause: error,
          });
        }
        const page =
          api === "google-generative-ai" ? parseGoogleModelListing(body) : parseModelListing(body);
        for (const model of page.models) {
          if (seenModelIds.has(model.id)) continue;
          seenModelIds.add(model.id);
          models.push(model);
        }

        if (api === "google-generative-ai") {
          if (!page.nextPageToken) return { models };
          if (seenCursors.has(page.nextPageToken)) {
            throw new EndpointDiscoveryError(
              "invalid-response",
              `${url} returned an invalid Google model-listing cursor.`,
            );
          }
          seenCursors.add(page.nextPageToken);
          cursor = page.nextPageToken;
          continue;
        }

        if (api !== "anthropic-messages" || !page.hasMore) return { models };
        if (!page.lastId || seenCursors.has(page.lastId)) {
          throw new EndpointDiscoveryError(
            "invalid-response",
            `${url} returned an invalid Anthropic model-listing cursor.`,
          );
        }
        seenCursors.add(page.lastId);
        cursor = page.lastId;
      }

      throw new EndpointDiscoveryError(
        "invalid-response",
        `${url} returned more than ${MODEL_LISTING_MAX_PAGES} model-listing pages.`,
      );
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      if (error instanceof EndpointDiscoveryError) throw discoveryError(input, error);
      throw discoveryError(
        input,
        new EndpointDiscoveryError("network", `Could not reach ${url}.`, { cause: error }),
      );
    }
  }
}
