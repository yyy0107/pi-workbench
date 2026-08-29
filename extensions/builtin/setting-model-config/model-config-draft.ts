import type {
  ConfigurableProviderView,
  DiscoveredModel,
  ModelProviderConfiguration,
  ModelProviderConfigValue,
  ModelProviderModelConfiguration,
} from "@/runtime/pi/contracts/rpc";

export const MODEL_PROVIDER_APIS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;

export type ModelProviderApi = (typeof MODEL_PROVIDER_APIS)[number];

/** Pi's fallback for custom model definitions without an explicit context window. */
export const DEFAULT_MODEL_CONTEXT_WINDOW = 128_000;

export interface ModelDraft {
  key: number;
  id: string;
  name: string;
  contextWindow: string;
  maxTokens: string;
  reasoning: boolean;
  thinkingLevelMap?: ModelProviderModelConfiguration["thinkingLevelMap"];
  /** Detected or explicitly selected model-type metadata. Undefined means unknown. */
  input?: ModelProviderModelConfiguration["input"];
  imageInputSource?: ModelProviderModelConfiguration["imageInputSource"];
  expanded: boolean;
}

export interface ProviderDraft {
  provider: string;
  displayName: string;
  authType: "api_key" | "oauth";
  apiKey: string;
  baseURL: string;
  defaultBaseURL: string;
  api: ModelProviderApi;
  customOpen: boolean;
  modelsSource: "adapter" | "custom";
  models: ModelDraft[];
  availableModels: ModelProviderModelConfiguration[];
}

export interface ProviderModelAvailability {
  configuredModelIds: string[];
  unavailableModelIds: string[];
}

export type ProviderTestDiscoverySource = "provider" | "endpoint";

export interface DiscoveredImageInputConfiguration {
  input: Array<"text" | "image">;
  imageInputSource: NonNullable<ModelProviderModelConfiguration["imageInputSource"]>;
}

export type ProviderDraftError =
  | "apiAddressRequired"
  | "modelRequired"
  | "invalidModel"
  | "duplicateModel";

export type PreparedProviderConfiguration =
  | { ok: true; configuration: ModelProviderConfiguration }
  | { ok: false; error: ProviderDraftError };

let nextModelKey = 1;

export function formatCapacity(value?: number): string {
  if (!value) return "";
  if (value % 1_000_000 === 0) return `${value / 1_000_000}M`;
  if (value % 1_000 === 0) return `${value / 1_000}K`;
  return String(value);
}

export function parseCapacity(value: string): number | undefined {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([km])?$/iu);
  if (!match) return undefined;
  const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2] ? 1_000 : 1;
  const result = Number(match[1]) * multiplier;
  return Number.isInteger(result) && result > 0 ? result : undefined;
}

export function normalizeContextWindowInput(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  if (/^\d+$/u.test(normalized)) return normalized;

  const capacity = parseCapacity(normalized);
  return capacity === undefined ? normalized.replace(/\D+/gu, "") : String(capacity);
}

export function modelNameAfterIdChange(
  model: Pick<ModelDraft, "id" | "name">,
  nextId: string,
): string {
  const currentName = model.name.trim();
  return !currentName || currentName === model.id.trim() ? nextId.trim() : model.name;
}

export function toModelDraft(model: ModelProviderModelConfiguration, expanded = false): ModelDraft {
  return {
    key: nextModelKey++,
    id: model.id,
    name: model.name?.trim() || model.id,
    contextWindow: normalizeContextWindowInput(
      String(model.contextWindow ?? DEFAULT_MODEL_CONTEXT_WINDOW),
    ),
    maxTokens: formatCapacity(model.maxTokens),
    reasoning: model.reasoning ?? false,
    ...(model.thinkingLevelMap ? { thinkingLevelMap: { ...model.thinkingLevelMap } } : {}),
    ...(model.input ? { input: [...model.input] } : {}),
    ...(model.imageInputSource ? { imageInputSource: model.imageInputSource } : {}),
    expanded,
  };
}

export function emptyModel(): ModelDraft {
  return toModelDraft({ id: "" });
}

export function preferredAuthType(provider?: ConfigurableProviderView): "api_key" | "oauth" {
  if (provider?.authType && provider.authMethods?.some(({ type }) => type === provider.authType)) {
    return provider.authType;
  }
  if (provider?.authMethods?.some(({ type }) => type === "oauth")) return "oauth";
  return "api_key";
}

export function emptyDraft(
  provider = "",
  authType: ProviderDraft["authType"] = "api_key",
): ProviderDraft {
  return {
    provider,
    displayName: "",
    authType,
    apiKey: "",
    baseURL: "",
    defaultBaseURL: "",
    api: "openai-completions",
    customOpen: false,
    modelsSource: "adapter",
    models: [],
    availableModels: [],
  };
}

export function evaluateProviderModelAvailability(
  configuredModels: readonly Pick<ModelDraft, "id">[],
  availableModels: readonly { id: string }[],
): ProviderModelAvailability {
  const availableModelIds = new Set(
    availableModels.map(({ id }) => id.trim()).filter((id) => id.length > 0),
  );
  const seenConfiguredModelIds = new Set<string>();
  const configuredModelIds: string[] = [];
  const unavailableModelIds: string[] = [];

  for (const model of configuredModels) {
    const id = model.id.trim();
    if (!id || seenConfiguredModelIds.has(id)) continue;
    seenConfiguredModelIds.add(id);
    configuredModelIds.push(id);
    if (!availableModelIds.has(id)) unavailableModelIds.push(id);
  }

  return { configuredModelIds, unavailableModelIds };
}

export function providerTestDiscoverySource(
  authType: ProviderDraft["authType"],
): ProviderTestDiscoverySource {
  return authType === "oauth" ? "provider" : "endpoint";
}

export function providerModelsForTest(
  draft: Pick<ProviderDraft, "availableModels" | "models" | "modelsSource">,
): readonly Pick<ModelProviderModelConfiguration, "id">[] {
  return draft.modelsSource === "adapter" ? draft.availableModels : draft.models;
}

export function discoveredImageInputConfiguration(
  modelId: string,
  availableModels: readonly DiscoveredModel[],
): DiscoveredImageInputConfiguration | undefined {
  const normalizedModelId = modelId.trim();
  if (!normalizedModelId) return undefined;

  const discovered = availableModels.find(({ id }) => id.trim() === normalizedModelId);
  if (!discovered || discovered.imageInput === "unknown") return undefined;

  return {
    input: discovered.imageInput === "supported" ? ["text", "image"] : ["text"],
    imageInputSource: discovered.imageInputSource ?? "provider-api",
  };
}

export function toProviderDraft(
  provider: ConfigurableProviderView,
  configuration: ModelProviderConfigValue,
): ProviderDraft {
  return {
    provider: provider.provider,
    displayName: configuration.displayName,
    authType: preferredAuthType(provider),
    apiKey: "",
    baseURL: configuration.baseURL ?? "",
    defaultBaseURL: configuration.defaultBaseURL ?? "",
    api: MODEL_PROVIDER_APIS.find((api) => api === configuration.api) ?? "openai-completions",
    customOpen: false,
    modelsSource: configuration.modelsSource,
    models: configuration.models.map((model) => toModelDraft(model)),
    availableModels: configuration.models,
  };
}

export function restoreAdapterModelDrafts(draft: ProviderDraft): ProviderDraft {
  return {
    ...draft,
    modelsSource: "adapter",
    models: draft.availableModels.map((model) => toModelDraft(model)),
  };
}

export function prepareProviderConfiguration(draft: ProviderDraft): PreparedProviderConfiguration {
  const baseURL = draft.baseURL.trim() || draft.defaultBaseURL.trim();
  if (!baseURL) return { ok: false, error: "apiAddressRequired" };
  if (draft.modelsSource === "custom" && draft.models.length === 0) {
    return { ok: false, error: "modelRequired" };
  }

  const models: ModelProviderModelConfiguration[] = [];
  for (const model of draft.modelsSource === "custom" ? draft.models : []) {
    const id = model.id.trim();
    const name = model.name.trim();
    const rawContextWindow = model.contextWindow.trim();
    const contextWindow = rawContextWindow
      ? parseCapacity(rawContextWindow)
      : DEFAULT_MODEL_CONTEXT_WINDOW;
    const maxTokens = model.maxTokens.trim() ? parseCapacity(model.maxTokens) : undefined;
    if (!id || (rawContextWindow && !contextWindow) || (model.maxTokens.trim() && !maxTokens)) {
      return { ok: false, error: "invalidModel" };
    }
    models.push({
      id,
      ...(name && name !== id ? { name } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
      ...(model.reasoning
        ? {
            reasoning: true,
            ...(model.thinkingLevelMap ? { thinkingLevelMap: { ...model.thinkingLevelMap } } : {}),
          }
        : {}),
      ...(model.input && model.imageInputSource
        ? {
            input: [...new Set(model.input)],
            imageInputSource: model.imageInputSource,
          }
        : {}),
    });
  }

  if (new Set(models.map(({ id }) => id)).size !== models.length) {
    return { ok: false, error: "duplicateModel" };
  }

  return {
    ok: true,
    configuration: {
      ...(draft.displayName.trim() ? { displayName: draft.displayName.trim() } : {}),
      baseURL,
      api: draft.api,
      ...(draft.modelsSource === "custom" ? { models } : {}),
    },
  };
}
