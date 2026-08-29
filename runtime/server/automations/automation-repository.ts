import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { atomicReplaceFile, withCrossProcessFileLock } from "@/runtime/server/file-persistence";
import type { AutomationDefinition, AutomationSessionReference } from "@/runtime/shared/automation";
import { AutomationError } from "./automation-errors";

const MAX_SESSION_REFERENCES = 200;
const AUTOMATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export interface AutomationRepositoryOptions {
  rootDirectory: string;
  now?: () => number;
}

function nodeErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

function definitionId(id: string): string {
  if (!AUTOMATION_ID_PATTERN.test(id)) throw new TypeError("Invalid automation ID.");
  return id;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

function clone(definition: AutomationDefinition): AutomationDefinition {
  const cloned = structuredClone(definition);
  const model = cloned.model as unknown;
  if (isRecord(model) && typeof model.provider === "string" && typeof model.modelId === "string") {
    cloned.model = {
      provider: model.provider,
      model: model.modelId,
      ...(typeof model.thinkingLevel === "string" ? { reasoningEffort: model.thinkingLevel } : {}),
    };
  }
  return cloned;
}

export class AutomationRepository {
  readonly rootDirectory: string;
  private readonly now: () => number;

  constructor(options: AutomationRepositoryOptions) {
    this.rootDirectory = path.resolve(options.rootDirectory);
    this.now = options.now ?? Date.now;
  }

  createId(): string {
    return randomUUID();
  }

  private definitionFile(automationId: string): string {
    return path.join(this.rootDirectory, "definitions", `${definitionId(automationId)}.json`);
  }

  async list(): Promise<AutomationDefinition[]> {
    let files: string[];
    try {
      files = (await readdir(path.join(this.rootDirectory, "definitions"), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => path.join(this.rootDirectory, "definitions", entry.name));
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT") return [];
      throw error;
    }
    const definitions = await Promise.all(
      files.map(async (file) => (await readJson(file)) as AutomationDefinition | undefined),
    );
    return definitions
      .filter((item): item is AutomationDefinition => item?.schemaVersion === 1)
      .map(clone)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async read(automationId: string): Promise<AutomationDefinition> {
    const value = await readJson(this.definitionFile(automationId));
    if (!value) {
      throw new AutomationError("automation-not-found", "The automation does not exist.", {
        automationId,
      });
    }
    return clone(value as AutomationDefinition);
  }

  async create(definition: AutomationDefinition): Promise<AutomationDefinition> {
    const file = this.definitionFile(definition.id);
    return withCrossProcessFileLock({ lockDirectory: `${file}.lock` }, async () => {
      if ((await readJson(file)) !== undefined) {
        throw new AutomationError("automation-conflict", "The automation already exists.", {
          automationId: definition.id,
          currentRevision: definition.revision,
        });
      }
      await atomicReplaceFile(file, json(definition));
      return clone(definition);
    });
  }

  async replace(
    automationId: string,
    baseRevision: number,
    update: (current: AutomationDefinition) => AutomationDefinition,
  ): Promise<AutomationDefinition> {
    const file = this.definitionFile(automationId);
    return withCrossProcessFileLock({ lockDirectory: `${file}.lock` }, async () => {
      const current = await this.read(automationId);
      if (current.revision !== baseRevision) {
        throw new AutomationError("automation-conflict", "The automation changed elsewhere.", {
          automationId,
          currentRevision: current.revision,
        });
      }
      const next = update(current);
      await atomicReplaceFile(file, json(next));
      return clone(next);
    });
  }

  async updateRuntime(
    automationId: string,
    update: (current: AutomationDefinition) => AutomationDefinition,
  ): Promise<AutomationDefinition> {
    const file = this.definitionFile(automationId);
    return withCrossProcessFileLock({ lockDirectory: `${file}.lock` }, async () => {
      const current = await this.read(automationId);
      const next = update(current);
      await atomicReplaceFile(file, json(next));
      return clone(next);
    });
  }

  async recordSession(
    automationId: string,
    reference: AutomationSessionReference,
  ): Promise<AutomationDefinition> {
    return this.updateRuntime(automationId, (current) => {
      const { lastError: _lastError, ...rest } = current;
      return {
        ...rest,
        lastTriggeredAt: reference.triggeredAt,
        lastSessionId: reference.sessionId,
        sessions: [
          reference,
          ...current.sessions.filter(({ sessionId }) => sessionId !== reference.sessionId),
        ].slice(0, MAX_SESSION_REFERENCES),
      };
    });
  }

  async recordError(automationId: string, reason: string): Promise<AutomationDefinition> {
    return this.updateRuntime(automationId, (current) => ({
      ...current,
      lastTriggeredAt: this.now(),
      lastError: reason,
    }));
  }
}
