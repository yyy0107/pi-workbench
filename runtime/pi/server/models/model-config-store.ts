import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type {
  ModelProviderConfiguration,
  ModelProviderModelConfiguration,
} from "../../rpc-contracts";

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

const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 30_000;

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
  return next;
}

export class ModelConfigStore implements ModelConfigStorage {
  readonly stateFile: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: ModelConfigStoreOptions = {}) {
    this.stateFile = options.stateFile ?? path.join(getAgentDir(), "models.json");
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
    await mkdir(path.dirname(this.stateFile), { recursive: true });
    if (content === undefined) {
      await rm(this.stateFile, { force: true });
      return;
    }
    const temporary = `${this.stateFile}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.stateFile);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    let releaseQueue!: () => void;
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    await previous;

    const lockDirectory = `${this.stateFile}.workbench-lock`;
    const deadline = Date.now() + LOCK_WAIT_MS;
    let acquired = false;
    try {
      await mkdir(path.dirname(lockDirectory), { recursive: true });
      for (;;) {
        try {
          await mkdir(lockDirectory);
          acquired = true;
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          const lockStat = await stat(lockDirectory).catch(() => undefined);
          if (lockStat && Date.now() - lockStat.mtimeMs > LOCK_STALE_MS) {
            await rm(lockDirectory, { recursive: true, force: true });
            continue;
          }
          if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${lockDirectory}`);
          await delay(25);
        }
      }
      return await operation();
    } finally {
      if (acquired) await rm(lockDirectory, { recursive: true, force: true });
      releaseQueue();
    }
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
      await this.writeContent(serialized({ ...state, providers }));
      return { rollback: () => this.withLock(() => this.writeContent(previous)) };
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
      providers[provider] = {
        ...currentProvider,
        modelOverrides: {
          ...modelOverrides,
          [model]: { ...currentOverride, contextWindow },
        },
      };
      await this.writeContent(serialized({ ...state, providers }));
      return { rollback: () => this.withLock(() => this.writeContent(previous)) };
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
      await this.writeContent(serialized({ ...state, providers }));
      return { rollback: () => this.withLock(() => this.writeContent(previous)) };
    });
  }
}
