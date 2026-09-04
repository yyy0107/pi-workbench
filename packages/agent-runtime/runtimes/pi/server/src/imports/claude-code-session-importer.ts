import os from "node:os";
import path from "node:path";

import type { Message, TextContent, ThinkingContent, ToolCall, Usage } from "@earendil-works/pi-ai";

import type {
  ExternalSessionDescriptor,
  ExternalSessionImporter,
  ExternalSessionSourceSnapshot,
  LoadedExternalSession,
} from "./external-session-types";
import {
  assistantMessage,
  boundedText,
  fileTimes,
  finiteNumber,
  isRecord,
  jsonlFiles,
  mapSettledWithConcurrency,
  parseArguments,
  readJsonl,
  textBlocks,
  timestamp,
  titleFromText,
  workspaceIssue,
  ZERO_USAGE,
} from "./source-utils";

function claudeProjectsRoot(): string {
  const configRoot = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  return path.join(configRoot, "projects");
}

function sourceMessages(records: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const messages = records.filter(
    (record) =>
      (record.type === "user" || record.type === "assistant") &&
      typeof record.uuid === "string" &&
      isRecord(record.message),
  );
  const byId = new Map(messages.map((record) => [String(record.uuid), record]));
  const explicitLeaf = [...records]
    .reverse()
    .find(
      (record) => record.type === "last-prompt" && typeof record.leafUuid === "string",
    )?.leafUuid;
  let leaf = typeof explicitLeaf === "string" ? explicitLeaf : String(messages.at(-1)?.uuid ?? "");
  if (!leaf || !byId.has(leaf)) return messages;
  const branch: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  while (leaf && !seen.has(leaf)) {
    seen.add(leaf);
    const record = byId.get(leaf);
    if (!record) break;
    branch.push(record);
    leaf = typeof record.parentUuid === "string" ? record.parentUuid : "";
  }
  return branch.reverse();
}

function claudeUsage(value: unknown): Usage {
  if (!isRecord(value)) return ZERO_USAGE;
  const input = finiteNumber(value.input_tokens);
  const output = finiteNumber(value.output_tokens);
  const cacheRead = finiteNumber(value.cache_read_input_tokens);
  const cacheWrite = finiteNumber(value.cache_creation_input_tokens);
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    ...(isRecord(value.cache_creation)
      ? {
          cacheWrite1h: finiteNumber(value.cache_creation.ephemeral_1h_input_tokens),
        }
      : {}),
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function claudeStopReason(value: unknown): "stop" | "length" | "toolUse" | "error" {
  if (value === "tool_use") return "toolUse";
  if (value === "max_tokens") return "length";
  if (value === "end_turn" || value === "stop_sequence" || value === null) return "stop";
  return "error";
}

function claudeToolResultContent(value: unknown): TextContent[] {
  const blocks = textBlocks(value);
  return blocks.length > 0 ? blocks : [{ type: "text", text: "" }];
}

export function parseClaudeCodeRecords(
  records: readonly Record<string, unknown>[],
  fallbackId = "claude-session",
  fallbackCreatedAt = Date.now(),
): LoadedExternalSession {
  const branch = sourceMessages(records);
  const first = branch[0] ?? records[0];
  const fallbackSourceSessionId = path.basename(fallbackId, ".jsonl");
  const parentSessionId = records.find((record) => typeof record.sessionId === "string")?.sessionId;
  const subagent = fallbackSourceSessionId.startsWith("agent-");
  const agentId = subagent
    ? (records.find((record) => typeof record.agentId === "string")?.agentId ??
      fallbackSourceSessionId.slice("agent-".length))
    : undefined;
  const sourceSessionId =
    subagent && parentSessionId
      ? `${parentSessionId}:agent:${String(agentId)}`
      : (parentSessionId ?? fallbackSourceSessionId);
  const cwd =
    branch.find((record) => typeof record.cwd === "string")?.cwd ??
    records.find((record) => typeof record.cwd === "string")?.cwd ??
    "";
  const messages: Message[] = [];
  const toolNames = new Map<string, string>();
  let model = "claude";

  for (const record of branch) {
    const message = isRecord(record.message) ? record.message : undefined;
    if (!message) continue;
    const eventTime = timestamp(record.timestamp, fallbackCreatedAt);
    const content = message.content;
    if (record.type === "assistant") {
      if (typeof message.model === "string") model = message.model;
      const parts: Array<TextContent | ThinkingContent | ToolCall> = [];
      for (const block of Array.isArray(content) ? content : []) {
        if (!isRecord(block)) continue;
        if (block.type === "text") {
          const text = boundedText(block.text);
          if (text) parts.push({ type: "text", text });
        } else if (block.type === "thinking") {
          const thinking = boundedText(block.thinking);
          if (thinking) parts.push({ type: "thinking", thinking });
        } else if (block.type === "tool_use" && typeof block.id === "string") {
          const name = typeof block.name === "string" && block.name ? block.name : "external_tool";
          toolNames.set(block.id, name);
          parts.push({
            type: "toolCall",
            id: block.id,
            name,
            arguments: parseArguments(block.input),
          });
        }
      }
      if (parts.length === 0) continue;
      messages.push(
        assistantMessage({
          content: parts,
          timestamp: eventTime,
          provider: "anthropic",
          model,
          api: "anthropic-messages",
          usage: claudeUsage(message.usage),
          stopReason: claudeStopReason(message.stop_reason),
        }),
      );
      continue;
    }

    const userBlocks = Array.isArray(content) ? content : undefined;
    if (userBlocks) {
      const userText: TextContent[] = [];
      for (const block of userBlocks) {
        if (!isRecord(block)) continue;
        if (block.type === "text") {
          const text = boundedText(block.text);
          if (text) userText.push({ type: "text", text });
        } else if (block.type === "image") {
          userText.push({ type: "text", text: "[Image attachment omitted during import]" });
        } else if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
          messages.push({
            role: "toolResult",
            toolCallId: block.tool_use_id,
            toolName: toolNames.get(block.tool_use_id) ?? "external_tool",
            content: claudeToolResultContent(block.content),
            isError: block.is_error === true,
            timestamp: eventTime,
          });
        }
      }
      if (userText.length > 0)
        messages.push({ role: "user", content: userText, timestamp: eventTime });
    } else {
      const text = boundedText(content);
      if (text) messages.push({ role: "user", content: text, timestamp: eventTime });
    }
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
  const createdAt = timestamp(first?.timestamp, fallbackCreatedAt);
  return {
    descriptor: {
      source: "claude-code",
      sourceSessionId: String(sourceSessionId),
      title: titleFromText(firstUserText, `Claude Code ${String(sourceSessionId).slice(0, 8)}`),
      cwd: String(cwd),
      createdAt,
      updatedAt: Math.max(createdAt, ...messages.map((message) => message.timestamp)),
      messageCount: messages.length,
      ...(subagent ? { subagent: true } : {}),
    },
    messages,
    model: { provider: "anthropic", modelId: model },
  };
}

async function scanClaudeFile(filePath: string): Promise<ExternalSessionDescriptor> {
  const times = await fileTimes(filePath);
  const fallbackId = path.basename(filePath, ".jsonl");
  const records: Record<string, unknown>[] = [];
  let foundConversation = false;
  await readJsonl(
    filePath,
    (record) => {
      records.push(record);
      foundConversation ||= record.type === "user" || record.type === "assistant";
    },
    { stop: (_record, count) => foundConversation || count >= 300 },
  );
  const parsed = parseClaudeCodeRecords(records, fallbackId, times.createdAt);
  const issue = await workspaceIssue(parsed.descriptor.cwd);
  return {
    ...parsed.descriptor,
    updatedAt: times.updatedAt,
    messageCount: undefined,
    importable: issue === undefined,
    alreadyImported: false,
    ...(issue ? { issue } : {}),
  };
}

export class ClaudeCodeSessionImporter implements ExternalSessionImporter {
  readonly source = "claude-code" as const;
  private filesById = new Map<string, string>();

  async scan(): Promise<ExternalSessionSourceSnapshot> {
    const files = await jsonlFiles(claudeProjectsRoot());
    if (files.length === 0) return { source: this.source, status: "not-found", sessions: [] };
    const settled = await mapSettledWithConcurrency(files, 8, scanClaudeFile);
    const sessions: ExternalSessionDescriptor[] = [];
    this.filesById.clear();
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index];
      if (result.status !== "fulfilled") continue;
      sessions.push(result.value);
      this.filesById.set(result.value.sourceSessionId, files[index]);
    }
    return {
      source: this.source,
      status: sessions.length > 0 ? "ready" : "error",
      sessions: sessions.sort((left, right) => right.updatedAt - left.updatedAt),
    };
  }

  async load(sourceSessionId: string): Promise<LoadedExternalSession | undefined> {
    if (!this.filesById.has(sourceSessionId)) await this.scan();
    const filePath = this.filesById.get(sourceSessionId);
    if (!filePath) return undefined;
    const times = await fileTimes(filePath);
    const records: Record<string, unknown>[] = [];
    await readJsonl(filePath, (record) => {
      if (record.type === "user" || record.type === "assistant" || record.type === "last-prompt") {
        records.push(record);
      }
    });
    return parseClaudeCodeRecords(records, path.basename(filePath, ".jsonl"), times.createdAt);
  }
}
