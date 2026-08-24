import type {
  ConfigurableProviderView,
  ModelProviderConfiguration,
  ModelProviderConfigValue,
  ModelProviderModelConfiguration,
} from "@/runtime/pi/rpc-contracts";

export const MODEL_PROVIDER_APIS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;

export type ModelProviderApi = (typeof MODEL_PROVIDER_APIS)[number];

export interface ModelDraft {
  key: number;
  id: string;
  name: string;
  contextWindow: string;
  maxTokens: string;
  supportsImages: boolean;
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

export function toModelDraft(model: ModelProviderModelConfiguration, expanded = false): ModelDraft {
  return {
    key: nextModelKey++,
    id: model.id,
    name: model.name ?? "",
    contextWindow: normalizeContextWindowInput(String(model.contextWindow ?? "")),
    maxTokens: formatCapacity(model.maxTokens),
    supportsImages: model.input?.includes("image") === true,
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
    models:
      configuration.modelsSource === "custom"
        ? configuration.models.map((model) => toModelDraft(model))
        : [],
    availableModels: configuration.models,
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
    const contextWindow = model.contextWindow.trim()
      ? parseCapacity(model.contextWindow)
      : undefined;
    const maxTokens = model.maxTokens.trim() ? parseCapacity(model.maxTokens) : undefined;
    if (
      !id ||
      (model.contextWindow.trim() && !contextWindow) ||
      (model.maxTokens.trim() && !maxTokens)
    ) {
      return { ok: false, error: "invalidModel" };
    }
    models.push({
      id,
      ...(model.name.trim() ? { name: model.name.trim() } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
      input: model.supportsImages ? ["text", "image"] : ["text"],
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
