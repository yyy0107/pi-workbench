import { createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import type { KnownProvider } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

import { PI_THINKING_LEVELS, type PiThinkingLevel } from "../../contracts";
import type {
  ConfigurableProviderView,
  ConfigureModelProviderPayload,
  DiscoverModelsPayload,
  DiscoverModelsValue,
  DiscoveredModel,
  ModelCatalogFailure,
  ModelCatalogModel,
  ModelCatalogValue,
  ModelProviderGroup,
  ModelProviderConfigValue,
  ModelProviderModelConfiguration,
  ModelProvidersValue,
} from "../../rpc-contracts";
import {
  ModelConfigStore,
  type ModelConfigMutation,
  type ModelConfigStorage,
} from "./model-config-store";

export type {
  ConfigurableProviderView,
  DiscoveredModel,
  ModelCatalogFailure,
  ModelCatalogModel,
  ModelProviderGroup,
  ModelSelection,
} from "../../rpc-contracts";

export type ModelProvidersResult = ModelProvidersValue;
export type ModelCatalogResult = ModelCatalogValue;
export type DiscoverModelsInput = DiscoverModelsPayload;
export type DiscoverModelsResult = DiscoverModelsValue;

export interface ModelServiceErrorDetails {
  "model-discovery-failed": {
    settingsNs: string;
    baseURL?: string;
  };
  "model-provider-not-found": {
    provider: string;
  };
  "model-provider-api-key-unsupported": {
    provider: string;
  };
  "model-provider-configuration-failed": {
    provider: string;
  };
  "model-provider-configuration-readonly": {
    provider: string;
  };
}

export type ModelServiceErrorCode = keyof ModelServiceErrorDetails;

export class ModelServiceError<
  Code extends ModelServiceErrorCode = ModelServiceErrorCode,
> extends Error {
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
  signal?: AbortSignal;
}

export interface ModelRuntimeAuthInteraction {
  signal?: AbortSignal;
  prompt(prompt: ModelRuntimeAuthPrompt): Promise<string>;
  notify(event: unknown): void;
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

const RUNTIME_FAILURE_ID = "model-runtime";
const RUNTIME_FAILURE_NAME = "Model runtime";
const MODEL_LISTING_RESPONSE_LIMIT = 4 * 1024 * 1024;
const MODEL_LISTING_PAGE_LIMIT = 1000;
const MODEL_LISTING_MAX_PAGES = 100;
const ANTHROPIC_VERSION = "2023-06-01";
const LISTABLE_MODEL_APIS = new Set([
  "anthropic-messages",
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
const BUILTIN_PROVIDER_DEFAULT_BASE_URLS = new Map(
  builtinProviders().flatMap((provider) => {
    const baseURL = provider.baseUrl || provider.getModels()[0]?.baseUrl;
    return baseURL ? [[provider.id, baseURL] as const] : [];
  }),
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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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

export function toModelCatalogModel(model: ModelRuntimeModel): ModelCatalogModel {
  const reasoning = modelReasoning(model);
  return {
    id: model.id,
    name: model.name || model.id,
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
): ModelServiceErrorDetails["model-discovery-failed"] {
  return {
    settingsNs: input.settingsNs,
    ...(input.baseURL ? { baseURL: input.baseURL } : {}),
  };
}

function discoveryError(input: DiscoverModelsInput, cause?: unknown): ModelServiceError {
  return new ModelServiceError(
    "model-discovery-failed",
    cause instanceof EndpointDiscoveryError ? cause.message : "Model discovery failed.",
    discoveryDetails(input),
    cause === undefined ? undefined : { cause },
  );
}

class EndpointDiscoveryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EndpointDiscoveryError";
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
  return {
    id,
    ...(name ? { name } : {}),
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
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

function runtimeModelConfiguration(model: ModelRuntimeModel): ModelProviderModelConfiguration {
  return {
    id: model.id,
    ...(model.name && model.name !== model.id ? { name: model.name } : {}),
    ...(Number.isInteger(model.contextWindow) && model.contextWindow > 0
      ? { contextWindow: model.contextWindow }
      : {}),
    ...(Number.isInteger(model.maxTokens) && model.maxTokens > 0
      ? { maxTokens: model.maxTokens }
      : {}),
  };
}

interface ModelListingEntry {
  id?: unknown;
  name?: unknown;
  display_name?: unknown;
  max_input_tokens?: unknown;
  context_window?: unknown;
  context_length?: unknown;
  max_tokens?: unknown;
  max_output_tokens?: unknown;
}

interface ModelListingPage {
  models: DiscoveredModel[];
  hasMore: boolean;
  lastId?: string;
}

function modelListingUrl(baseURL: string, api: string, afterId?: string): string {
  const normalized = baseURL.replace(/\/+$/u, "");
  if (api !== "anthropic-messages") return `${normalized}/models`;

  const endpoint = normalized.endsWith("/v1") ? `${normalized}/models` : `${normalized}/v1/models`;
  const url = new URL(endpoint);
  url.searchParams.set("limit", String(MODEL_LISTING_PAGE_LIMIT));
  if (afterId) url.searchParams.set("after_id", afterId);
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

function requestApiKey(raw: string): string {
  const key = raw.trim();
  if (!key) {
    throw new EndpointDiscoveryError("The request-scoped API key is blank.");
  }
  if (!/^[\x21-\x7e]+$/u.test(key)) {
    throw new EndpointDiscoveryError(
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
    models.push({
      id,
      ...(name ? { name } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
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
  };
}

export class ModelService {
  private readonly cwd: string;
  private readonly serviceFactory: ModelServiceFactory;
  private readonly injectedRuntime?: ModelRuntimeLike;
  private readonly fetcher: typeof fetch;
  private readonly settingsOverrides?: ModelServiceOptions["providerSettings"];
  private readonly modelConfigStore: ModelConfigStorage;
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
          resolveProjectTrust: async () => process.env.PI_WORKBENCH_TRUST_PROJECT === "1",
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
      return {
        provider: entry.provider,
        displayName: entry.displayName,
        settingsNs: entry.settingsNs,
        settingsPath: [...entry.settingsPath],
        active: active.has(entry.provider),
        ...(entry.declared === undefined ? {} : { declared: entry.declared }),
        configured: status?.configured ?? false,
        ...(status?.source ? { authSource: status.source } : {}),
        apiKeyConfigurable: typeof route?.auth?.apiKey?.login === "function",
        removable:
          !internal.has(entry.provider) &&
          (entry.provider in storedConfigurations ||
            status?.source === "stored" ||
            status?.source === "runtime"),
        configurationDefined: entry.provider in storedConfigurations,
      };
    });

    // A live route without a configurable-directory declaration is still
    // visible, but it must not advertise a made-up settings address.
    for (const route of registered) {
      if (declared.has(route.id)) continue;
      const status = runtime.getProviderAuthStatus?.(route.id);
      providers.push({
        provider: route.id,
        displayName: route.name || route.id,
        settingsNs: "",
        settingsPath: [],
        active: true,
        configured: status?.configured ?? false,
        ...(status?.source ? { authSource: status.source } : {}),
        apiKeyConfigurable: typeof route.auth?.apiKey?.login === "function",
        removable:
          !internal.has(route.id) &&
          (route.id in storedConfigurations ||
            status?.source === "stored" ||
            status?.source === "runtime"),
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
      models: stored?.models ?? runtimeModels.map(runtimeModelConfiguration),
    };
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

    const directory = configurableProviderDirectory(runtime.getProviders(), this.settingsOverrides);
    if (internalProviderIds(runtime, directory).has(input.provider)) {
      throw new ModelServiceError(
        "model-provider-configuration-readonly",
        "Built-in model providers cannot be deleted.",
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
    const entries = await Promise.all(
      providers.map(async (provider) => {
        try {
          const models = await runtime.getAvailable(provider.id);
          return {
            group: {
              id: provider.id,
              name: provider.name || provider.id,
              models: [...models]
                .sort((left, right) => compareText(left.id, right.id))
                .map(toModelCatalogModel),
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
    if (provider) {
      const catalog = runtime?.getModels(provider) ?? [];
      if (catalog.length > 0) {
        return {
          models: [...catalog]
            .sort((left, right) => compareText(left.id, right.id))
            .map(discoveredModel),
        };
      }
    }

    if (!input.baseURL) throw discoveryError(input);

    const api = input.api ?? "openai-completions";
    if (!LISTABLE_MODEL_APIS.has(api)) {
      throw discoveryError(
        input,
        new EndpointDiscoveryError(
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
          : apiKey
            ? { authorization: `Bearer ${apiKey}` }
            : {}),
      };
      const models: DiscoveredModel[] = [];
      const seenModelIds = new Set<string>();
      const seenCursors = new Set<string>();
      let afterId: string | undefined;
      let remainingBytes = MODEL_LISTING_RESPONSE_LIMIT;

      for (let pageIndex = 0; pageIndex < MODEL_LISTING_MAX_PAGES; pageIndex += 1) {
        url = modelListingUrl(input.baseURL, api, afterId);
        const response = await this.fetcher(url, {
          method: "GET",
          headers,
          ...(signal ? { signal } : {}),
        });
        signal?.throwIfAborted();
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          throw new EndpointDiscoveryError(
            `${url} answered ${response.status}${
              response.status === 401 || response.status === 403 ? "; check the API key" : ""
            }.`,
          );
        }

        const text = await readBoundedListing(response, url, signal, remainingBytes);
        remainingBytes -= new TextEncoder().encode(text).byteLength;
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch (error) {
          throw new EndpointDiscoveryError(`${url} did not answer with JSON.`, { cause: error });
        }
        const page = parseModelListing(body);
        for (const model of page.models) {
          if (seenModelIds.has(model.id)) continue;
          seenModelIds.add(model.id);
          models.push(model);
        }

        if (api !== "anthropic-messages" || !page.hasMore) return { models };
        if (!page.lastId || seenCursors.has(page.lastId)) {
          throw new EndpointDiscoveryError(
            `${url} returned an invalid Anthropic model-listing cursor.`,
          );
        }
        seenCursors.add(page.lastId);
        afterId = page.lastId;
      }

      throw new EndpointDiscoveryError(
        `${url} returned more than ${MODEL_LISTING_MAX_PAGES} model-listing pages.`,
      );
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      if (error instanceof EndpointDiscoveryError) throw discoveryError(input, error);
      throw discoveryError(
        input,
        new EndpointDiscoveryError(`Could not reach ${url}.`, { cause: error }),
      );
    }
  }
}
