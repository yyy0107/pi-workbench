import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Message, TextContent, ToolCall, Usage } from "@earendil-works/pi-ai";

import type {
  ExternalSessionDescriptor,
  ExternalSessionSourceAdapter,
  ExternalSessionSourceSnapshot,
  LoadedExternalSession,
} from "./external-session-types";
import {
  assistantMessage,
  boundedText,
  finiteNumber,
  isRecord,
  parseArguments,
  timestamp,
  titleFromText,
  workspaceIssue,
} from "./source-utils";

interface CursorHeaderRow {
  composerId: string;
  workspaceId: string;
  createdAt: number | null;
  lastUpdatedAt: number | null;
  isSubagent: number | null;
  value: string | Uint8Array | null;
}

interface CursorValueRow {
  value: string | Uint8Array | null;
}

interface CursorConversationHeader {
  bubbleId: string;
  type?: number;
  createdAt?: string;
}

function cursorDatabaseCandidates(): string[] {
  const home = os.homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return [path.join(appData, "Cursor", "User", "globalStorage", "state.vscdb")];
  }
  if (process.platform === "darwin") {
    return [
      path.join(
        home,
        "Library",
        "Application Support",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb",
      ),
    ];
  }
  const config = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return [path.join(config, "Cursor", "User", "globalStorage", "state.vscdb")];
}

function decodeJson(value: string | Uint8Array | null): Record<string, unknown> | undefined {
  if (value === null) return undefined;
  const text = typeof value === "string" ? value : Buffer.from(value).toString("utf8");
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function cursorCwd(header: Record<string, unknown>): string {
  const workspaceIdentifier = isRecord(header.workspaceIdentifier)
    ? header.workspaceIdentifier
    : undefined;
  const uri =
    workspaceIdentifier && isRecord(workspaceIdentifier.uri) ? workspaceIdentifier.uri : undefined;
  if (uri && typeof uri.fsPath === "string") return uri.fsPath;
  if (Array.isArray(header.trackedGitRepos)) {
    const repository = header.trackedGitRepos.find(
      (item): item is Record<string, unknown> =>
        isRecord(item) && typeof item.repoPath === "string",
    );
    if (repository && typeof repository.repoPath === "string") return repository.repoPath;
  }
  return "";
}

function cursorModel(composer: Record<string, unknown>): string {
  const config = isRecord(composer.modelConfig) ? composer.modelConfig : undefined;
  if (config && typeof config.modelName === "string") return config.modelName;
  if (config && Array.isArray(config.selectedModels)) {
    const selected = config.selectedModels.find(
      (item): item is Record<string, unknown> => isRecord(item) && typeof item.modelId === "string",
    );
    if (selected && typeof selected.modelId === "string") return selected.modelId;
  }
  return "cursor-model";
}

function cursorUsage(value: unknown): Usage | undefined {
  if (!isRecord(value)) return undefined;
  const input = finiteNumber(value.inputTokens);
  const output = finiteNumber(value.outputTokens);
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function cursorToolContent(tool: Record<string, unknown>): string {
  if (typeof tool.result === "string") return boundedText(tool.result);
  if (typeof tool.additionalData === "string") return boundedText(tool.additionalData);
  if (isRecord(tool.additionalData)) {
    try {
      return boundedText(JSON.stringify(tool.additionalData));
    } catch {
      return "";
    }
  }
  return "";
}

export function parseCursorConversation(options: {
  composerId: string;
  header: Record<string, unknown>;
  composer: Record<string, unknown>;
  bubbles: readonly Record<string, unknown>[];
  createdAt: number;
  updatedAt: number;
  subagent?: boolean;
}): LoadedExternalSession {
  const messages: Message[] = [];
  const model = cursorModel(options.composer);
  for (const bubble of options.bubbles) {
    const eventTime = timestamp(bubble.createdAt, options.createdAt);
    const bubbleType = finiteNumber(bubble.type, -1);
    const text = boundedText(bubble.text);
    if (bubbleType === 1) {
      if (text) messages.push({ role: "user", content: text, timestamp: eventTime });
      continue;
    }
    if (bubbleType !== 2) continue;
    if (text) {
      messages.push(
        assistantMessage({
          content: [{ type: "text", text }],
          timestamp: eventTime,
          provider: "cursor",
          model,
          api: "openai-responses",
          usage: cursorUsage(bubble.tokenCount),
        }),
      );
    }
    const tool = isRecord(bubble.toolFormerData) ? bubble.toolFormerData : undefined;
    if (!tool) continue;
    const callId =
      typeof tool.toolCallId === "string" && tool.toolCallId
        ? tool.toolCallId
        : `cursor-${String(bubble.bubbleId ?? messages.length)}`;
    const name = typeof tool.name === "string" && tool.name ? tool.name : "external_tool";
    const toolCall: ToolCall = {
      type: "toolCall",
      id: callId,
      name,
      arguments: parseArguments(tool.rawArgs ?? tool.params),
    };
    messages.push(
      assistantMessage({
        content: [toolCall],
        timestamp: eventTime,
        provider: "cursor",
        model,
        api: "openai-responses",
        stopReason: "toolUse",
      }),
    );
    messages.push({
      role: "toolResult",
      toolCallId: callId,
      toolName: name,
      content: [{ type: "text", text: cursorToolContent(tool) }],
      isError: tool.status === "error",
      timestamp: eventTime,
    });
  }

  const firstUser = messages.find((message) => message.role === "user");
  const firstUserText =
    firstUser?.role === "user"
      ? typeof firstUser.content === "string"
        ? firstUser.content
        : firstUser.content
            .filter((part): part is TextContent => part.type === "text")
            .map((part) => part.text)
            .join("\n")
      : "";
  const configuredName = typeof options.header.name === "string" ? options.header.name : "";
  return {
    descriptor: {
      source: "cursor",
      sourceSessionId: options.composerId,
      title: titleFromText(
        configuredName || firstUserText,
        `Cursor ${options.composerId.slice(0, 8)}`,
      ),
      cwd: cursorCwd(options.header),
      createdAt: options.createdAt,
      updatedAt: options.updatedAt,
      messageCount: messages.length,
      ...(options.subagent ? { subagent: true } : {}),
    },
    messages,
    model: { provider: "cursor", modelId: model },
  };
}

export class CursorSessionAdapter implements ExternalSessionSourceAdapter {
  readonly source = "cursor" as const;
  private databasePath: string | undefined;
  private descriptors = new Map<string, ExternalSessionDescriptor>();

  private open(): DatabaseSync | undefined {
    this.databasePath ??= cursorDatabaseCandidates().find((candidate) => existsSync(candidate));
    return this.databasePath ? new DatabaseSync(this.databasePath, { readOnly: true }) : undefined;
  }

  async scan(): Promise<ExternalSessionSourceSnapshot> {
    const database = this.open();
    if (!database) return { source: this.source, status: "not-found", sessions: [] };
    try {
      const tables = new Set(
        (
          database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
            name: string;
          }>
        ).map((row) => row.name),
      );
      if (!tables.has("composerHeaders") || !tables.has("cursorDiskKV")) {
        return { source: this.source, status: "error", sessions: [] };
      }
      const rows = database
        .prepare(
          "SELECT composerId, workspaceId, createdAt, lastUpdatedAt, isSubagent, value FROM composerHeaders ORDER BY COALESCE(lastUpdatedAt, createdAt) DESC",
        )
        .all() as unknown as CursorHeaderRow[];
      const composerStatement = database.prepare("SELECT value FROM cursorDiskKV WHERE key = ?");
      const sessions: ExternalSessionDescriptor[] = [];
      this.descriptors.clear();
      for (const row of rows) {
        if (!row.composerId || row.composerId === "empty-state-draft") continue;
        const header = decodeJson(row.value);
        if (!header) continue;
        const cwd = cursorCwd(header);
        const issue = await workspaceIssue(cwd);
        const composerRow = composerStatement.get(`composerData:${row.composerId}`) as
          | CursorValueRow
          | undefined;
        const composer = composerRow ? decodeJson(composerRow.value) : undefined;
        const messageCount = Array.isArray(composer?.fullConversationHeadersOnly)
          ? composer.fullConversationHeadersOnly.length
          : undefined;
        const createdAt = finiteNumber(row.createdAt, timestamp(header.createdAt));
        const updatedAt = finiteNumber(
          row.lastUpdatedAt,
          timestamp(header.lastUpdatedAt, createdAt),
        );
        const title = titleFromText(header.name, `Cursor ${row.composerId.slice(0, 8)}`);
        const descriptor: ExternalSessionDescriptor = {
          source: "cursor",
          sourceSessionId: row.composerId,
          title,
          cwd,
          createdAt,
          updatedAt,
          ...(messageCount === undefined ? {} : { messageCount }),
          ...(row.isSubagent ? { subagent: true } : {}),
          importable: issue === undefined && composer !== undefined,
          alreadyImported: false,
          ...(issue ? { issue } : composer ? {} : { issue: "conversation-unsupported" as const }),
        };
        sessions.push(descriptor);
        this.descriptors.set(row.composerId, descriptor);
      }
      return { source: this.source, status: "ready", sessions };
    } finally {
      database.close();
    }
  }

  async load(sourceSessionId: string): Promise<LoadedExternalSession | undefined> {
    if (!this.descriptors.has(sourceSessionId)) await this.scan();
    const descriptor = this.descriptors.get(sourceSessionId);
    if (!descriptor) return undefined;
    const database = this.open();
    if (!database) return undefined;
    try {
      const headerRow = database
        .prepare("SELECT value FROM composerHeaders WHERE composerId = ?")
        .get(sourceSessionId) as CursorValueRow | undefined;
      const composerRow = database
        .prepare("SELECT value FROM cursorDiskKV WHERE key = ?")
        .get(`composerData:${sourceSessionId}`) as CursorValueRow | undefined;
      const header = headerRow ? decodeJson(headerRow.value) : undefined;
      const composer = composerRow ? decodeJson(composerRow.value) : undefined;
      if (!header || !composer || !Array.isArray(composer.fullConversationHeadersOnly))
        return undefined;
      const bubbleStatement = database.prepare("SELECT value FROM cursorDiskKV WHERE key = ?");
      const bubbles: Record<string, unknown>[] = [];
      for (const rawHeader of composer.fullConversationHeadersOnly) {
        if (!isRecord(rawHeader) || typeof rawHeader.bubbleId !== "string") continue;
        const conversationHeader = rawHeader as unknown as CursorConversationHeader;
        const row = bubbleStatement.get(
          `bubbleId:${sourceSessionId}:${conversationHeader.bubbleId}`,
        ) as CursorValueRow | undefined;
        const bubble = row ? decodeJson(row.value) : undefined;
        if (bubble) bubbles.push(bubble);
      }
      return parseCursorConversation({
        composerId: sourceSessionId,
        header,
        composer,
        bubbles,
        createdAt: descriptor.createdAt,
        updatedAt: descriptor.updatedAt,
        subagent: descriptor.subagent,
      });
    } finally {
      database.close();
    }
  }
}
