import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type {
  ModelProviderConfiguration,
  ModelProviderModelConfiguration,
} from "../../rpc-contracts";
import { atomicReplaceFile, withCrossProcessFileLock } from "../core/file-persistence";

interface JsonObject {
  [key: string]: unknown;
}

interface ModelsFile extends JsonObject {
  providers?: Record<string, unknown>;
}

export interface StoredModelProviderConfiguration {
  displayName?: string;
  baseURL?: string;
  api?: string;
  models?: ModelProviderModelConfiguration[];
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

function modelConfiguration(value: unknown): ModelProviderModelConfiguration | undefined {
  if (!isObject(value) || typeof value.id !== "string" || !value.id) return undefined;
  return {
    id: value.id,
    ...(typeof value.name === "string" && value.name ? { name: value.name } : {}),
    ...(typeof value.contextWindow === "number" ? { contextWindow: value.contextWindow } : {}),
    ...(typeof value.maxTokens === "number" ? { maxTokens: value.maxTokens } : {}),
    ...(Array.isArray(value.input) &&
    value.input.every((item) => item === "text" || item === "image")
      ? { input: [...new Set(value.input)] as Array<"text" | "image"> }
      : {}),
  };
}

function safeProvider(value: unknown): StoredModelProviderConfiguration {
  if (!isObject(value)) return {};
  const models = Array.isArray(value.models)
    ? value.models.flatMap((model) => {
        const parsed = modelConfiguration(model);
        return parsed ? [parsed] : [];
      })
    : undefined;
  return {
    ...(typeof value.name === "string" && value.name ? { displayName: value.name } : {}),
    ...(typeof value.baseUrl === "string" && value.baseUrl ? { baseURL: value.baseUrl } : {}),
    ...(typeof value.api === "string" && value.api ? { api: value.api } : {}),
    ...(models ? { models } : {}),
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
  if (model.input) next.input = [...new Set(model.input)];
  else delete next.input;
  return next;
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
    return Object.fromEntries(
      Object.entries(state.providers ?? {}).map(([provider, value]) => [
        provider,
        safeProvider(value),
      ]),
    );
  }

  async setProvider(
    provider: string,
    configuration: ModelProviderConfiguration,
  ): Promise<ModelConfigMutation> {
    return this.withLock(async () => {
      const previous = await this.readContent();
      const state = previous === undefined ? {} : parseModelsFile(previous);
      const providers = { ...state.providers };
      const current = isObject(providers[provider]) ? providers[provider] : {};
      const existingModels = new Map(
        (Array.isArray(current.models) ? current.models : [])
          .filter(isObject)
          .map((model) => [model.id, model] as const),
      );
      const nextProvider: JsonObject = {
        ...current,
        name: configuration.displayName || provider,
        baseUrl: configuration.baseURL,
        api: configuration.api,
      };
      if (configuration.models) {
        nextProvider.models = configuration.models.map((model) =>
          storedModel(existingModels.get(model.id), model),
        );
      } else {
        delete nextProvider.models;
      }
      providers[provider] = nextProvider;
      return this.writeMutation(previous, serialized({ ...state, providers }));
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

  async removeProvider(provider: string): Promise<ModelConfigMutation | undefined> {
    return this.withLock(async () => {
      const previous = await this.readContent();
      if (previous === undefined) return undefined;
      const state = parseModelsFile(previous);
      const providers = { ...state.providers };
      if (!(provider in providers)) return undefined;
      delete providers[provider];
      return this.writeMutation(previous, serialized({ ...state, providers }));
    });
  }
}
