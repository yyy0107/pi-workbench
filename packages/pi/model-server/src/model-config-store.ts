import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type {
  ModelCapabilitySource,
  ModelProviderConfiguration,
  ModelProviderModelConfiguration,
  ModelThinkingLevelMap,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import {
  atomicReplaceFile,
  withCrossProcessFileLock,
} from "@workbench/server-core/file-persistence";

interface JsonObject {
  [key: string]: unknown;
}

interface ModelsFile extends JsonObject {
  providers?: Record<string, unknown>;
}

const BUILTIN_PROVIDERS = builtinProviders();
const BUILTIN_MODELS = new Map(
  BUILTIN_PROVIDERS.map((provider) => [
    provider.id,
    new Map(provider.getModels().map((model) => [model.id, model])),
  ]),
);
const BUILTIN_PROVIDER_BASE_URLS = new Map(
  BUILTIN_PROVIDERS.map((provider) => [
    provider.id,
    new Set(
      [provider.baseUrl, ...provider.getModels().map((model) => model.baseUrl)]
        .filter((url): url is string => !!url)
        .map((url) => url.replace(/\/+$/u, "")),
    ),
  ]),
);

const CAPABILITY_SOURCES_KEY = "x-workbench-model-capability-sources";
// Keep the settings page's explicit model list while Pi reads built-in edits as overrides.
const CUSTOM_MODEL_IDS_KEY = "x-workbench-custom-model-ids";
const MODEL_OVERRIDE_FIELDS = new Set([
  "id",
  "name",
  "reasoning",
  "thinkingLevelMap",
  "input",
  "contextWindow",
  "maxTokens",
]);
type CapabilitySources = Record<string, Record<string, ModelCapabilitySource>>;
const MODEL_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export interface StoredModelProviderConfiguration {
  displayName?: string;
  baseURL?: string;
  api?: string;
  models?: ModelProviderModelConfiguration[];
  modelOverrides?: Record<string, { contextWindow?: number }>;
}

export interface ModelConfigMutation {
  /**
   * Restores the pre-mutation file only while both the current bytes and write revision still
   * belong to this mutation. A newer write makes rollback a no-op even when it writes identical
   * bytes, so an older failed request cannot overwrite it.
   */
  rollback(): Promise<void>;
}

export interface ModelConfigStorage {
  providers(): Promise<Record<string, StoredModelProviderConfiguration>>;
  setModelContextWindow(
    provider: string,
    model: string,
    contextWindow: number,
  ): Promise<ModelConfigMutation>;
  resetModelContextWindow(
    provider: string,
    model: string,
  ): Promise<ModelConfigMutation | undefined>;
  setProvider(
    provider: string,
    configuration: ModelProviderConfiguration,
  ): Promise<ModelConfigMutation>;
  removeProvider(provider: string): Promise<ModelConfigMutation | undefined>;
}

export interface ModelConfigStoreOptions {
  stateFile?: string;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Pi accepts line comments and trailing commas in models.json. Keep this parser
// aligned with that public file format while leaving string literals untouched.
function stripJsonComments(input: string): string {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/gu, (match) => (match[0] === '"' ? match : ""))
    .replace(
      /"(?:\\.|[^"\\])*"|,(\s*[}\]])/gu,
      (match, tail: string | undefined) => tail ?? (match[0] === '"' ? match : ""),
    );
}

function parseModelsFile(content: string): ModelsFile {
  const parsed: unknown = JSON.parse(stripJsonComments(content));
  if (!isObject(parsed)) throw new TypeError("models.json must contain a JSON object.");
  if (parsed.providers !== undefined && !isObject(parsed.providers)) {
    throw new TypeError("models.json providers must contain a JSON object.");
  }
  return parsed as ModelsFile;
}

function modelThinkingLevelMap(value: unknown): ModelThinkingLevelMap | undefined {
  if (!isObject(value)) return undefined;
  const entries = MODEL_THINKING_LEVELS.flatMap((level) => {
    const mapped = value[level];
    return typeof mapped === "string" || mapped === null ? [[level, mapped] as const] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function modelConfiguration(
  value: unknown,
  imageInputSource?: ModelCapabilitySource,
): ModelProviderModelConfiguration | undefined {
  if (!isObject(value) || typeof value.id !== "string" || !value.id) return undefined;
  const thinkingLevelMap = modelThinkingLevelMap(value.thinkingLevelMap);
  return {
    id: value.id,
    ...(typeof value.name === "string" && value.name ? { name: value.name } : {}),
    ...(typeof value.contextWindow === "number" ? { contextWindow: value.contextWindow } : {}),
    ...(typeof value.maxTokens === "number" ? { maxTokens: value.maxTokens } : {}),
    ...(typeof value.reasoning === "boolean" ? { reasoning: value.reasoning } : {}),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    ...(Array.isArray(value.input) &&
    value.input.every((item) => item === "text" || item === "image")
      ? { input: [...new Set(value.input)] as Array<"text" | "image"> }
      : {}),
    ...(imageInputSource ? { imageInputSource } : {}),
  };
}

function capabilitySources(value: unknown): CapabilitySources {
  if (!isObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([provider, models]) => {
      if (!isObject(models)) return [];
      const sources = Object.fromEntries(
        Object.entries(models).filter(
          (entry): entry is [string, ModelCapabilitySource] =>
            entry[1] === "provider-api" ||
            entry[1] === "runtime" ||
            entry[1] === "test" ||
            entry[1] === "user",
        ),
      );
      return Object.keys(sources).length > 0 ? [[provider, sources]] : [];
    }),
  );
}

function stateWithCapabilitySources(
  state: ModelsFile,
  providers: Record<string, unknown>,
  sources: CapabilitySources,
): ModelsFile {
  const next: ModelsFile = { ...state, providers };
  if (Object.keys(sources).length > 0) next[CAPABILITY_SOURCES_KEY] = sources;
  else delete next[CAPABILITY_SOURCES_KEY];
  return next;
}

function safeProvider(
  value: unknown,
  sources: Readonly<Record<string, ModelCapabilitySource>> = {},
): StoredModelProviderConfiguration {
  if (!isObject(value)) return {};
  const models = configuredModels(value)?.flatMap((model) => {
    const parsed = modelConfiguration(
      model,
      isObject(model) && typeof model.id === "string" ? sources[model.id] : undefined,
    );
    return parsed ? [parsed] : [];
  });
  const modelOverrides = isObject(value.modelOverrides)
    ? Object.fromEntries(
        Object.entries(value.modelOverrides).flatMap(([model, override]) =>
          isObject(override) &&
          typeof override.contextWindow === "number" &&
          Number.isInteger(override.contextWindow) &&
          override.contextWindow > 0
            ? [[model, { contextWindow: override.contextWindow }]]
            : [],
        ),
      )
    : undefined;
  return {
    ...(typeof value.name === "string" && value.name ? { displayName: value.name } : {}),
    ...(typeof value.baseUrl === "string" && value.baseUrl ? { baseURL: value.baseUrl } : {}),
    ...(typeof value.api === "string" && value.api ? { api: value.api } : {}),
    ...(models ? { models } : {}),
    ...(modelOverrides && Object.keys(modelOverrides).length > 0 ? { modelOverrides } : {}),
  };
}

function serialized(state: ModelsFile): string {
  return `${JSON.stringify(state, undefined, 2)}\n`;
}

function storedModel(
  current: JsonObject | undefined,
  model: ModelProviderModelConfiguration,
): JsonObject {
  const next: JsonObject = { ...current, id: model.id };
  if (model.name) next.name = model.name;
  else delete next.name;
  if (model.contextWindow) next.contextWindow = model.contextWindow;
  else delete next.contextWindow;
  if (model.maxTokens) next.maxTokens = model.maxTokens;
  else delete next.maxTokens;
  if (model.reasoning !== undefined) next.reasoning = model.reasoning;
  else delete next.reasoning;
  if (model.thinkingLevelMap) next.thinkingLevelMap = { ...model.thinkingLevelMap };
  else delete next.thinkingLevelMap;
  if (model.input) next.input = [...new Set(model.input)];
  else delete next.input;
  return next;
}

function customModelIds(provider: JsonObject): string[] {
  const ids = provider[CUSTOM_MODEL_IDS_KEY];
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

function configuredModels(provider: JsonObject): JsonObject[] | undefined {
  const models = Array.isArray(provider.models) ? provider.models.filter(isObject) : undefined;
  const ids = customModelIds(provider);
  if (ids.length === 0) return models;
  const custom = new Map(models?.map((model) => [model.id, model]));
  const overrides = isObject(provider.modelOverrides) ? provider.modelOverrides : {};
  const configured = ids.map(
    (id) =>
      custom.get(id) ?? {
        ...modelConfiguration({ ...(isObject(overrides[id]) ? overrides[id] : {}), id }),
        id,
      },
  );
  const configuredIds = new Set(ids);
  return [
    ...configured,
    ...(models?.filter((model) => !configuredIds.has(String(model.id))) ?? []),
  ];
}

/** Pi's models array replaces built-ins; modelOverrides retains their protocol metadata. */
function normalizeBuiltinModels(providerId: string, provider: JsonObject): boolean {
  const builtins = BUILTIN_MODELS.get(providerId);
  if (!builtins || !Array.isArray(provider.models)) return false;
  const overrides = isObject(provider.modelOverrides) ? { ...provider.modelOverrides } : {};
  let changed = false;
  const ids = configuredModels(provider)?.map((model) => model.id) ?? [];
  const models = provider.models.filter((model) => {
    if (!isObject(model) || typeof model.id !== "string") return true;
    const builtin = builtins.get(model.id);
    // Only migrate the fields Workbench edits. Hand-written routes/metadata stay intact.
    if (
      !builtin ||
      (provider.api !== undefined && provider.api !== builtin.api) ||
      !Object.keys(model).every((key) => MODEL_OVERRIDE_FIELDS.has(key))
    )
      return true;
    const { id: _id, ...fields } = model;
    const currentOverride = overrides[model.id];
    const existing = isObject(currentOverride) ? currentOverride : {};
    overrides[model.id] = {
      ...fields,
      ...existing,
      ...(isObject(fields.thinkingLevelMap) && isObject(existing.thinkingLevelMap)
        ? { thinkingLevelMap: { ...fields.thinkingLevelMap, ...existing.thinkingLevelMap } }
        : {}),
    };
    changed = true;
    return false;
  });
  if (!changed) return false;
  provider.models = models;
  provider.modelOverrides = overrides;
  provider[CUSTOM_MODEL_IDS_KEY] = ids;
  return true;
}

export class ModelConfigStore implements ModelConfigStorage {
  readonly stateFile: string;
  private readonly revisionFile: string;

  constructor(options: ModelConfigStoreOptions = {}) {
    this.stateFile = options.stateFile ?? path.join(getAgentDir(), "models.json");
    this.revisionFile = `${this.stateFile}.workbench-revision`;
  }

  private async readContent(): Promise<string | undefined> {
    try {
      return await readFile(this.stateFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async writeContent(content: string | undefined): Promise<void> {
    if (content === undefined) {
      await rm(this.stateFile, { force: true });
      return;
    }
    await atomicReplaceFile(this.stateFile, content);
  }

  private async readRevision(): Promise<string | undefined> {
    try {
      return await readFile(this.revisionFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async writeRevision(revision: string | undefined): Promise<void> {
    if (revision === undefined) {
      await rm(this.revisionFile, { force: true });
      return;
    }
    await atomicReplaceFile(this.revisionFile, revision);
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    return withCrossProcessFileLock(
      { lockDirectory: `${this.stateFile}.workbench-lock` },
      operation,
    );
  }

  private async writeMutation(
    previous: string | undefined,
    next: string | undefined,
  ): Promise<ModelConfigMutation> {
    const previousRevision = await this.readRevision();
    const revision = randomUUID();
    // Publish the identity before the content. If the content write fails, advancing the identity
    // must be compensated while the same cross-process lock is still held; otherwise a failed
    // mutation could incorrectly invalidate an older request's still-valid rollback.
    await this.writeRevision(revision);
    try {
      await this.writeContent(next);
    } catch (writeError) {
      try {
        await this.writeRevision(previousRevision);
      } catch (revisionError) {
        throw new AggregateError(
          [writeError, revisionError],
          "Failed to write model configuration and restore its mutation revision.",
        );
      }
      throw writeError;
    }
    return {
      rollback: () =>
        this.withLock(async () => {
          if ((await this.readRevision()) !== revision) return;
          if ((await this.readContent()) !== next) return;
          await this.writeRevision(randomUUID());
          await this.writeContent(previous);
        }),
    };
  }

  async providers(): Promise<Record<string, StoredModelProviderConfiguration>> {
    const content = await this.readContent();
    if (content === undefined) return {};
    const state = parseModelsFile(content);
    const sources = capabilitySources(state[CAPABILITY_SOURCES_KEY]);
    return Object.fromEntries(
      Object.entries(state.providers ?? {}).map(([provider, value]) => [
        provider,
        safeProvider(value, sources[provider]),
      ]),
    );
  }

  async migrateBuiltinModelOverrides(): Promise<boolean> {
    const migrate = (content: string): ModelsFile | undefined => {
      let state: ModelsFile;
      try {
        state = parseModelsFile(content);
      } catch {
        // Leave invalid files to Pi's existing configuration diagnostics.
        return undefined;
      }
      let changed = false;
      for (const [provider, value] of Object.entries(state.providers ?? {})) {
        if (isObject(value) && normalizeBuiltinModels(provider, value)) changed = true;
      }
      return changed ? state : undefined;
    };
    const content = await this.readContent();
    if (content === undefined || !migrate(content)) return false;
    return this.withLock(async () => {
      const previous = await this.readContent();
      if (previous === undefined) return false;
      const state = migrate(previous);
      if (!state) return false;
      await this.writeMutation(previous, serialized(state));
      return true;
    });
  }

  async setProvider(
    provider: string,
    configuration: ModelProviderConfiguration,
  ): Promise<ModelConfigMutation> {
    return this.withLock(async () => {
      const previous = await this.readContent();
      const state = previous === undefined ? {} : parseModelsFile(previous);
      const providers = { ...state.providers };
      const sources = capabilitySources(state[CAPABILITY_SOURCES_KEY]);
      const current = isObject(providers[provider]) ? providers[provider] : {};
      const existingModels = new Map(
        configuredModels(current)?.map((model) => [model.id, model] as const),
      );
      const nextProvider: JsonObject = {
        ...current,
        name: configuration.displayName || provider,
        baseUrl: configuration.baseURL,
        api: configuration.api,
      };
      const modelOverrides = isObject(current.modelOverrides) ? { ...current.modelOverrides } : {};
      for (const id of customModelIds(current)) {
        if (
          Array.isArray(current.models) &&
          current.models.some((model) => isObject(model) && model.id === id)
        )
          continue;
        if (!isObject(modelOverrides[id])) continue;
        const { id: _id, ...remaining } = storedModel(modelOverrides[id], { id });
        if (Object.keys(remaining).length > 0) modelOverrides[id] = remaining;
        else delete modelOverrides[id];
      }
      delete nextProvider[CUSTOM_MODEL_IDS_KEY];
      if (configuration.models) {
        nextProvider.models = configuration.models.map((model) =>
          storedModel(existingModels.get(model.id), model),
        );
        // Saving an explicit model capacity supersedes an older per-model capacity override.
        for (const model of configuration.models) {
          const override = modelOverrides[model.id];
          if (model.contextWindow === undefined || !isObject(override)) continue;
          const { contextWindow: _contextWindow, ...remaining } = override;
          if (Object.keys(remaining).length > 0) modelOverrides[model.id] = remaining;
          else delete modelOverrides[model.id];
        }
        const providerSources = Object.fromEntries(
          configuration.models.flatMap((model) =>
            model.imageInputSource ? [[model.id, model.imageInputSource] as const] : [],
          ),
        );
        if (Object.keys(providerSources).length > 0) sources[provider] = providerSources;
        else delete sources[provider];
      } else {
        delete nextProvider.models;
        delete sources[provider];
      }
      if (Object.keys(modelOverrides).length > 0) nextProvider.modelOverrides = modelOverrides;
      else delete nextProvider.modelOverrides;
      const builtinBaseURLs = BUILTIN_PROVIDER_BASE_URLS.get(provider);
      if (builtinBaseURLs) {
        // Built-ins can mix protocols and URL prefixes. Let each adapter model
        // inherit its own route instead of applying the first model's defaults to all.
        delete nextProvider.api;
        if (builtinBaseURLs.has(configuration.baseURL.replace(/\/+$/u, ""))) {
          delete nextProvider.baseUrl;
        }
      }
      normalizeBuiltinModels(provider, nextProvider);
      if (builtinBaseURLs && Object.keys(nextProvider).every((key) => key === "name")) {
        delete providers[provider];
      } else {
        providers[provider] = nextProvider;
      }
      return this.writeMutation(
        previous,
        serialized(stateWithCapabilitySources(state, providers, sources)),
      );
    });
  }

  async setModelContextWindow(
    provider: string,
    model: string,
    contextWindow: number,
  ): Promise<ModelConfigMutation> {
    return this.withLock(async () => {
      const previous = await this.readContent();
      const state = previous === undefined ? {} : parseModelsFile(previous);
      const providers = { ...state.providers };
      const currentProvider = isObject(providers[provider]) ? providers[provider] : {};
      const modelOverrides = isObject(currentProvider.modelOverrides)
        ? currentProvider.modelOverrides
        : {};
      const currentOverride = isObject(modelOverrides[model]) ? modelOverrides[model] : {};
      // `contextWindow` is local model-capacity metadata used for accounting and compaction.
      // Keep `maxTokens` untouched: it is the separate provider output-token budget.
      providers[provider] = {
        ...currentProvider,
        modelOverrides: {
          ...modelOverrides,
          [model]: { ...currentOverride, contextWindow },
        },
      };
      return this.writeMutation(previous, serialized({ ...state, providers }));
    });
  }

  async resetModelContextWindow(
    provider: string,
    model: string,
  ): Promise<ModelConfigMutation | undefined> {
    return this.withLock(async () => {
      const previous = await this.readContent();
      if (previous === undefined) return undefined;
      const state = parseModelsFile(previous);
      const providers = { ...state.providers };
      const currentProvider = isObject(providers[provider]) ? providers[provider] : undefined;
      if (!currentProvider || !isObject(currentProvider.modelOverrides)) return undefined;
      const currentOverride = isObject(currentProvider.modelOverrides[model])
        ? currentProvider.modelOverrides[model]
        : undefined;
      if (!currentOverride || !("contextWindow" in currentOverride)) return undefined;

      const nextOverride = { ...currentOverride };
      delete nextOverride.contextWindow;
      const nextOverrides = { ...currentProvider.modelOverrides };
      if (Object.keys(nextOverride).length > 0) nextOverrides[model] = nextOverride;
      else delete nextOverrides[model];
      const nextProvider = { ...currentProvider };
      if (Object.keys(nextOverrides).length > 0) nextProvider.modelOverrides = nextOverrides;
      else delete nextProvider.modelOverrides;
      providers[provider] = nextProvider;
      return this.writeMutation(previous, serialized({ ...state, providers }));
    });
  }

  async removeProvider(provider: string): Promise<ModelConfigMutation | undefined> {
    return this.withLock(async () => {
      const previous = await this.readContent();
      if (previous === undefined) return undefined;
      const state = parseModelsFile(previous);
      const providers = { ...state.providers };
      if (!(provider in providers)) return undefined;
      delete providers[provider];
      const sources = capabilitySources(state[CAPABILITY_SOURCES_KEY]);
      delete sources[provider];
      return this.writeMutation(
        previous,
        serialized(stateWithCapabilitySources(state, providers, sources)),
      );
    });
  }
}
