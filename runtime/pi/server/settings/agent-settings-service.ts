import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import {
  PI_AGENT_SETTINGS_NAMESPACE,
  type PiAgentSettingsNamespaceView,
  type PiAgentSettingsPatch,
  type PiAgentSettingsUpdatePayload,
  type PiAgentSettingsUserValue,
  type PiAgentSettingsValue,
  type PiCompactionSettingsValue,
  type SettingsDescribeValue,
} from "@/runtime/pi/contracts/rpc";
import { atomicReplaceFile, withCrossProcessFileLock } from "../core/file-persistence";
import { RpcDomainError } from "../core/rpc-domain-error";

type JsonObject = Record<string, unknown>;

export interface AgentSettingsServiceErrorDetails {
  "settings-not-exposed": { ns: string };
  "settings-conflict": { ns: string; expected: number; actual: number };
  "settings-rejected": { ns: string };
}

export type AgentSettingsServiceErrorCode = keyof AgentSettingsServiceErrorDetails;

export class AgentSettingsServiceError<
  Code extends AgentSettingsServiceErrorCode = AgentSettingsServiceErrorCode,
> extends RpcDomainError<Code, AgentSettingsServiceErrorDetails[Code]> {
  readonly code: Code;
  readonly details: AgentSettingsServiceErrorDetails[Code];

  constructor(
    code: Code,
    message: string,
    details: AgentSettingsServiceErrorDetails[Code],
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "AgentSettingsServiceError";
    this.code = code;
    this.details = details;
  }
}

export interface AgentSettingsServiceOptions {
  agentDir?: string;
}

export type AgentSettingsUpdateRequest = Omit<PiAgentSettingsUpdatePayload, "ns"> & {
  ns: string;
};

/** Stable transport-facing operations; Pi agent-directory ownership stays in this service. */
export interface AgentSettingsProtocol {
  describe(): Promise<SettingsDescribeValue>;
  prepareDocument(): Promise<string>;
  update(payload: AgentSettingsUpdateRequest): Promise<PiAgentSettingsNamespaceView>;
}

interface AgentSettingsSnapshot {
  settingsContent?: string;
  systemPromptContent?: string;
  settings: JsonObject;
  user: PiAgentSettingsUserValue;
  value: PiAgentSettingsValue;
  revision: number;
}

const DEFAULT_COMPACTION_SETTINGS = Object.freeze({
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
}) satisfies PiCompactionSettingsValue;

const AGENT_SETTINGS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    systemPrompt: {
      type: "string",
      description: "A custom global Pi system prompt. Empty uses Pi's bundled default.",
    },
    compaction: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean", default: DEFAULT_COMPACTION_SETTINGS.enabled },
        reserveTokens: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_COMPACTION_SETTINGS.reserveTokens,
        },
        keepRecentTokens: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
        },
      },
    },
  },
});

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new TypeError(`${field} must be a positive integer.`);
  }
  return value as number;
}

function parseCompaction(value: unknown): Partial<PiCompactionSettingsValue> | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new TypeError("compaction must be an object.");
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    throw new TypeError("compaction.enabled must be a boolean.");
  }
  return {
    ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
    ...(value.reserveTokens !== undefined
      ? { reserveTokens: positiveInteger(value.reserveTokens, "compaction.reserveTokens")! }
      : {}),
    ...(value.keepRecentTokens !== undefined
      ? {
          keepRecentTokens: positiveInteger(value.keepRecentTokens, "compaction.keepRecentTokens")!,
        }
      : {}),
  };
}

function parseSettings(content: string | undefined): {
  settings: JsonObject;
  compaction?: Partial<PiCompactionSettingsValue>;
} {
  if (content === undefined) return { settings: {} };
  const parsed: unknown = JSON.parse(content);
  if (!isObject(parsed)) throw new TypeError("settings.json must contain a JSON object.");
  return { settings: parsed, compaction: parseCompaction(parsed.compaction) };
}

function revisionOf(
  settingsContent: string | undefined,
  promptContent: string | undefined,
): number {
  const digest = createHash("sha256")
    .update(
      settingsContent === undefined ? "settings:absent" : `settings:present:${settingsContent}`,
    )
    .update("\0")
    .update(promptContent === undefined ? "prompt:absent" : `prompt:present:${promptContent}`)
    .digest();
  return digest.readUInt32BE(0);
}

function serializedSettings(settings: JsonObject): string {
  return `${JSON.stringify(settings, undefined, 2)}\n`;
}

export class AgentSettingsService implements AgentSettingsProtocol {
  readonly agentDir: string;
  readonly settingsFile: string;
  readonly systemPromptFile: string;

  constructor(options: AgentSettingsServiceOptions = {}) {
    this.agentDir = options.agentDir ?? getAgentDir();
    this.settingsFile = path.join(this.agentDir, "settings.json");
    this.systemPromptFile = path.join(this.agentDir, "SYSTEM.md");
  }

  private async readOptional(file: string): Promise<string | undefined> {
    try {
      return await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async snapshot(): Promise<AgentSettingsSnapshot> {
    const [settingsContent, systemPromptContent] = await Promise.all([
      this.readOptional(this.settingsFile),
      this.readOptional(this.systemPromptFile),
    ]);
    const { settings, compaction } = parseSettings(settingsContent);
    const user: PiAgentSettingsUserValue = {
      ...(systemPromptContent !== undefined ? { systemPrompt: systemPromptContent } : {}),
      ...(compaction && Object.keys(compaction).length > 0 ? { compaction } : {}),
    };
    return {
      settingsContent,
      systemPromptContent,
      settings,
      user,
      value: {
        systemPrompt: systemPromptContent ?? "",
        compaction: { ...DEFAULT_COMPACTION_SETTINGS, ...compaction },
      },
      revision: revisionOf(settingsContent, systemPromptContent),
    };
  }

  private namespace(snapshot: AgentSettingsSnapshot): PiAgentSettingsNamespaceView {
    return {
      ns: PI_AGENT_SETTINGS_NAMESPACE,
      schema: AGENT_SETTINGS_SCHEMA,
      value: snapshot.value,
      base: { systemPrompt: "", compaction: { ...DEFAULT_COMPACTION_SETTINGS } },
      user: snapshot.user,
      applies: "restart",
      secrets: [],
      revision: snapshot.revision,
    };
  }

  private async writeOptional(file: string, content: string | undefined): Promise<void> {
    if (content === undefined) {
      await rm(file, { force: true });
      return;
    }
    await atomicReplaceFile(file, content);
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    return withCrossProcessFileLock(
      { lockDirectory: path.join(this.agentDir, ".workbench-agent-settings-lock") },
      operation,
    );
  }

  async describe(): Promise<SettingsDescribeValue> {
    try {
      const snapshot = await this.snapshot();
      return {
        writable: true,
        hasDocument:
          snapshot.settingsContent !== undefined || snapshot.systemPromptContent !== undefined,
        namespaces: [this.namespace(snapshot)],
      };
    } catch (error) {
      throw new AgentSettingsServiceError(
        "settings-rejected",
        "Pi agent settings could not be read.",
        { ns: PI_AGENT_SETTINGS_NAMESPACE },
        { cause: error },
      );
    }
  }

  async prepareDocument(): Promise<string> {
    try {
      return await this.withLock(async () => {
        if ((await this.readOptional(this.settingsFile)) === undefined) {
          await this.writeOptional(this.settingsFile, serializedSettings({}));
        }
        return this.settingsFile;
      });
    } catch (error) {
      throw new AgentSettingsServiceError(
        "settings-rejected",
        "Pi agent settings document could not be prepared.",
        { ns: PI_AGENT_SETTINGS_NAMESPACE },
        { cause: error },
      );
    }
  }

  async update(payload: AgentSettingsUpdateRequest): Promise<PiAgentSettingsNamespaceView> {
    if (payload.ns !== PI_AGENT_SETTINGS_NAMESPACE) {
      throw new AgentSettingsServiceError(
        "settings-not-exposed",
        "The requested settings namespace is not exposed.",
        { ns: payload.ns },
      );
    }
    return this.withLock(async () => {
      let current: AgentSettingsSnapshot;
      try {
        current = await this.snapshot();
      } catch (error) {
        throw new AgentSettingsServiceError(
          "settings-rejected",
          "Pi agent settings could not be read.",
          { ns: payload.ns },
          { cause: error },
        );
      }
      if (payload.expectedRevision !== undefined && payload.expectedRevision !== current.revision) {
        throw new AgentSettingsServiceError(
          "settings-conflict",
          "Pi agent settings changed before this update was applied.",
          {
            ns: payload.ns,
            expected: payload.expectedRevision,
            actual: current.revision,
          },
        );
      }

      const patch: PiAgentSettingsPatch = payload.patch;
      let nextSettingsContent = current.settingsContent;
      let nextPromptContent = current.systemPromptContent;
      if (patch.compaction !== undefined) {
        const existingCompaction = isObject(current.settings.compaction)
          ? current.settings.compaction
          : {};
        nextSettingsContent = serializedSettings({
          ...current.settings,
          compaction: { ...existingCompaction, ...patch.compaction },
        });
      }
      if (patch.systemPrompt !== undefined) {
        nextPromptContent = patch.systemPrompt.trim().length > 0 ? patch.systemPrompt : undefined;
      }

      try {
        if (nextSettingsContent !== current.settingsContent) {
          await this.writeOptional(this.settingsFile, nextSettingsContent);
        }
        if (nextPromptContent !== current.systemPromptContent) {
          await this.writeOptional(this.systemPromptFile, nextPromptContent);
        }
        return this.namespace(await this.snapshot());
      } catch (error) {
        await Promise.allSettled([
          this.writeOptional(this.settingsFile, current.settingsContent),
          this.writeOptional(this.systemPromptFile, current.systemPromptContent),
        ]);
        throw new AgentSettingsServiceError(
          "settings-rejected",
          "Pi agent settings could not be saved.",
          { ns: payload.ns },
          { cause: error },
        );
      }
    });
  }
}
