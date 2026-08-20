import { createAgentSessionServices } from "@earendil-works/pi-coding-agent";

import { PI_THINKING_LEVELS, type PiThinkingLevel } from "../../contracts";
import type {
  ConfigurableProviderView,
  DiscoverModelsPayload,
  DiscoverModelsValue,
  DiscoveredModel,
  ModelCatalogFailure,
  ModelCatalogModel,
  ModelCatalogValue,
  ModelProviderGroup,
  ModelProvidersValue,
} from "../../rpc-contracts";

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
}

/** The subset of pi-ai's Provider used by the HTTP model catalog. */
export interface ModelRuntimeProvider {
  id: string;
  name: string;
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
  getProviderAuthStatus?(provider: string): { configured: boolean };
  getAuth?(
    provider: string,
    options?: { signal?: AbortSignal },
  ): Promise<ModelRuntimeAuthResult | undefined>;
  setRuntimeApiKey?(provider: string, apiKey: string): Promise<void>;
  removeRuntimeApiKey?(provider: string): Promise<void>;
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
  /** Injectable transport for request-scoped OpenAI-compatible model discovery. */
  fetcher?: typeof fetch;
  /** Overrides wire metadata when a provider is exposed by another settings namespace. */
  providerSettings?: Readonly<Record<string, ModelProviderSettings>>;
}

interface LoadedModelServices {
  runtime: ModelRuntimeLike;
  diagnostics: readonly ModelServiceDiagnostic[];
}

const RUNTIME_FAILURE_ID = "model-runtime";
const RUNTIME_FAILURE_NAME = "Model runtime";
const MODEL_LISTING_RESPONSE_LIMIT = 4 * 1024 * 1024;
const LISTABLE_MODEL_APIS = new Set(["openai-completions", "openai-responses"]);

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

interface ModelListingEntry {
  id?: unknown;
  name?: unknown;
  display_name?: unknown;
  context_window?: unknown;
  context_length?: unknown;
  max_tokens?: unknown;
  max_output_tokens?: unknown;
}

function modelListingUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/u, "")}/models`;
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
): Promise<string> {
  signal?.throwIfAborted();
  const oversized = () =>
    new EndpointDiscoveryError(
      `${url} answered with more than ${MODEL_LISTING_RESPONSE_LIMIT} bytes.`,
    );
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > MODEL_LISTING_RESPONSE_LIMIT) {
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
      if (total > MODEL_LISTING_RESPONSE_LIMIT) throw oversized();
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

function parseModelListing(body: unknown): DiscoveredModel[] {
  const data =
    typeof body === "object" && body !== null && "data" in body
      ? (body as { data: unknown }).data
      : undefined;
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
    const contextWindow = listingCapacity(entry.context_window, entry.context_length);
    const maxTokens = listingCapacity(entry.max_output_tokens, entry.max_tokens);
    models.push({
      id,
      ...(name ? { name } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
    });
  }
  return models;
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
  private loaded?: Promise<LoadedModelServices>;

  constructor(options: ModelServiceOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.serviceFactory = options.serviceFactory ?? createAgentSessionServices;
    this.injectedRuntime = options.runtime;
    this.fetcher = options.fetcher ?? fetch;
    this.settingsOverrides = options.providerSettings;
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
    // Pi's provider registry is the route authority. Authentication is a
    // separate concern: a registered route remains active while its credential
    // is absent or being edited.
    const registered = runtime.getProviders();
    const active = new Set(registered.map((provider) => provider.id));
    const directory = configurableProviderDirectory(registered, this.settingsOverrides);
    const declared = new Set(directory.map((entry) => entry.provider));
    const providers: ConfigurableProviderView[] = directory.map((entry) => ({
      provider: entry.provider,
      displayName: entry.displayName,
      settingsNs: entry.settingsNs,
      settingsPath: [...entry.settingsPath],
      active: active.has(entry.provider),
      ...(entry.declared === undefined ? {} : { declared: entry.declared }),
    }));

    // A live route without a configurable-directory declaration is still
    // visible, but it must not advertise a made-up settings address.
    for (const route of registered) {
      if (declared.has(route.id)) continue;
      providers.push({
        provider: route.id,
        displayName: route.name || route.id,
        settingsNs: "",
        settingsPath: [],
        active: true,
      });
    }

    return {
      providers: providers.sort((left, right) => compareText(left.provider, right.provider)),
    };
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

    try {
      const url = modelListingUrl(input.baseURL);
      signal?.throwIfAborted();
      const resolvedApiKey =
        input.apiKey === undefined && provider
          ? (await runtime?.getAuth?.(provider, { signal }))?.auth.apiKey
          : input.apiKey;
      signal?.throwIfAborted();
      const apiKey = resolvedApiKey === undefined ? undefined : requestApiKey(resolvedApiKey);
      const response = await this.fetcher(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
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

      const text = await readBoundedListing(response, url, signal);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch (error) {
        throw new EndpointDiscoveryError(`${url} did not answer with JSON.`, { cause: error });
      }
      return { models: parseModelListing(body) };
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      if (error instanceof EndpointDiscoveryError) throw discoveryError(input, error);
      const url = modelListingUrl(input.baseURL);
      throw discoveryError(
        input,
        new EndpointDiscoveryError(`Could not reach ${url}.`, { cause: error }),
      );
    }
  }
}
