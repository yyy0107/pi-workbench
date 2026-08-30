import os from "node:os";
import path from "node:path";

import type { Message, ThinkingContent, ToolCall } from "@earendil-works/pi-ai";

import type {
  ExternalSessionDescriptor,
  ExternalSessionSourceAdapter,
  ExternalSessionSourceSnapshot,
  LoadedExternalSession,
} from "./external-session-types";
import {
  assistantMessage,
  boundedText,
  fileTimes,
  isRecord,
  jsonlFiles,
  mapSettledWithConcurrency,
  parseArguments,
  readJsonl,
  textBlocks,
  timestamp,
  titleFromText,
  workspaceIssue,
} from "./source-utils";

interface CodexMetadata {
  sourceSessionId: string;
  cwd: string;
  createdAt: number;
  provider: string;
  model: string;
  title: string;
}

const CODEX_HOST_CONTEXT_ENVELOPES = [
  ["<recommended_plugins>", "</recommended_plugins>"],
  ["<environment_context>", "</environment_context>"],
  ["<app-context>", "</app-context>"],
  ["<skills_instructions>", "</skills_instructions>"],
  ["<permissions instructions>", "</permissions instructions>"],
  ["<collaboration_mode>", "</collaboration_mode>"],
  ["<apps_instructions>", "</apps_instructions>"],
  ["<plugins_instructions>", "</plugins_instructions>"],
] as const;
const CODEX_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function isCodexHostContext(value: string): boolean {
  const text = value.trim();
  if (
    text.startsWith("# AGENTS.md instructions") &&
    text.includes("<INSTRUCTIONS>") &&
    text.endsWith("</INSTRUCTIONS>")
  ) {
    return true;
  }
  return CODEX_HOST_CONTEXT_ENVELOPES.some(
    ([opening, closing]) => text.startsWith(opening) && text.endsWith(closing),
  );
}

function visibleCodexUserBlocks(value: unknown) {
  return textBlocks(value).filter((block) => !isCodexHostContext(block.text));
}

function codexTitleText(value: string): string {
  const requestHeading = /^## My request:[ \t]*\r?$/mu.exec(value);
  if (!requestHeading) return value;
  const request = value.slice(requestHeading.index + requestHeading[0].length).trim();
  return request || value;
}

function codexRoot(): string {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions");
}

function payload(record: Record<string, unknown>): Record<string, unknown> | undefined {
  return isRecord(record.payload) ? record.payload : undefined;
}

function metadataFromRecords(
  records: readonly Record<string, unknown>[],
  fallbackId: string,
  fallbackCreatedAt: number,
): CodexMetadata {
  let sourceSessionId = fallbackId;
  let cwd = "";
  let createdAt = fallbackCreatedAt;
  let provider = "openai";
  let model = "codex";
  let generatedTitle = "";
  let projectedUserTitle = "";
  let responseUserTitle = "";
  for (const record of records) {
    const value = payload(record);
    if (record.type === "session_meta" && value) {
      const recordedSessionId =
        typeof value.session_id === "string"
          ? value.session_id
          : typeof value.id === "string"
            ? value.id
            : "";
      // Rollout filenames are the source identity. Internal derived logs can retain a parent id
      // inside session_meta, so only use metadata when no filename-shaped UUID was supplied.
      if (recordedSessionId && !CODEX_SESSION_ID_PATTERN.test(fallbackId)) {
        sourceSessionId = recordedSessionId;
      }
      if (typeof value.cwd === "string") cwd = value.cwd;
      if (typeof value.model_provider === "string") provider = value.model_provider;
      createdAt = timestamp(value.timestamp ?? record.timestamp, createdAt);
    } else if (record.type === "turn_context" && value) {
      if (!cwd && typeof value.cwd === "string") cwd = value.cwd;
      if (typeof value.model === "string") model = value.model;
    } else if (record.type === "ai-title" && typeof record.aiTitle === "string") {
      generatedTitle = titleFromText(record.aiTitle, generatedTitle);
    }
    if (!responseUserTitle && record.type === "response_item" && value?.type === "message") {
      if (value.role === "user") {
        responseUserTitle = titleFromText(
          codexTitleText(
            visibleCodexUserBlocks(value.content)
              .map((part) => part.text)
              .join("\n"),
          ),
          "",
        );
      }
    }
    if (!projectedUserTitle && record.type === "event_msg" && value?.type === "user_message") {
      projectedUserTitle = titleFromText(codexTitleText(boundedText(value.message)), "");
    }
  }
  return {
    sourceSessionId,
    cwd,
    createdAt,
    provider,
    model,
    title:
      generatedTitle ||
      projectedUserTitle ||
      responseUserTitle ||
      `Codex ${sourceSessionId.slice(0, 8)}`,
  };
}

function hasProjectedUserMessages(records: readonly Record<string, unknown>[]): boolean {
  return records.some((record) => {
    const value = payload(record);
    return (
      record.type === "event_msg" &&
      value?.type === "user_message" &&
      boundedText(value.message).length > 0
    );
  });
}

function toolOutputText(value: unknown): string {
  if (typeof value === "string") return boundedText(value);
  return textBlocks(value)
    .map((part) => part.text)
    .join("\n");
}

export function parseCodexRecords(
  records: readonly Record<string, unknown>[],
  fallbackId = "codex-session",
  fallbackCreatedAt = Date.now(),
): LoadedExternalSession {
  const metadata = metadataFromRecords(records, fallbackId, fallbackCreatedAt);
  const messages: Message[] = [];
  const toolNames = new Map<string, string>();
  const seenUserText = new Set<string>();
  const preferProjectedUserMessages = hasProjectedUserMessages(records);
  let model = metadata.model;

  for (const record of records) {
    const value = payload(record);
    if (!value) continue;
    const eventTime = timestamp(record.timestamp, metadata.createdAt);
    if (record.type === "turn_context" && typeof value.model === "string") {
      model = value.model;
      continue;
    }
    if (record.type === "response_item" && value.type === "message") {
      const blocks =
        value.role === "user" ? visibleCodexUserBlocks(value.content) : textBlocks(value.content);
      if (blocks.length === 0) continue;
      const textKey = blocks.map((block) => block.text).join("\n");
      if (value.role === "user") {
        if (preferProjectedUserMessages) continue;
        seenUserText.add(textKey);
        messages.push({ role: "user", content: blocks, timestamp: eventTime });
      } else if (value.role === "assistant") {
        messages.push(
          assistantMessage({
            content: blocks,
            timestamp: eventTime,
            provider: metadata.provider,
            model,
            api: "openai-responses",
          }),
        );
      }
      continue;
    }
    if (record.type === "response_item" && value.type === "reasoning") {
      const summary = textBlocks(value.summary)
        .map((part) => part.text)
        .join("\n");
      if (!summary) continue;
      const thinking: ThinkingContent = { type: "thinking", thinking: summary };
      messages.push(
        assistantMessage({
          content: [thinking],
          timestamp: eventTime,
          provider: metadata.provider,
          model,
          api: "openai-responses",
        }),
      );
      continue;
    }
    if (record.type === "response_item" && value.type === "custom_tool_call") {
      const callId = typeof value.call_id === "string" ? value.call_id : String(value.id ?? "");
      const name = typeof value.name === "string" && value.name ? value.name : "external_tool";
      if (!callId) continue;
      toolNames.set(callId, name);
      const toolCall: ToolCall = {
        type: "toolCall",
        id: callId,
        name,
        arguments: parseArguments(value.input),
      };
      messages.push(
        assistantMessage({
          content: [toolCall],
          timestamp: eventTime,
          provider: metadata.provider,
          model,
          api: "openai-responses",
          stopReason: "toolUse",
        }),
      );
      continue;
    }
    if (record.type === "response_item" && value.type === "custom_tool_call_output") {
      const callId = typeof value.call_id === "string" ? value.call_id : String(value.id ?? "");
      if (!callId) continue;
      const output = toolOutputText(value.output);
      messages.push({
        role: "toolResult",
        toolCallId: callId,
        toolName: toolNames.get(callId) ?? "external_tool",
        content: [{ type: "text", text: output }],
        isError: false,
        timestamp: eventTime,
      });
      continue;
    }
    // event_msg is Codex's user-visible projection. Prefer it over raw input context when present;
    // it also remains the fallback for older logs that contain no response_item user message.
    if (record.type === "event_msg" && value.type === "user_message") {
      const text = boundedText(value.message);
      if (!text || seenUserText.has(text)) continue;
      seenUserText.add(text);
      messages.push({ role: "user", content: text, timestamp: eventTime });
    }
  }

  return {
    descriptor: {
      source: "codex",
      sourceSessionId: metadata.sourceSessionId,
      title: metadata.title,
      cwd: metadata.cwd,
      createdAt: metadata.createdAt,
      updatedAt: Math.max(metadata.createdAt, ...messages.map((message) => message.timestamp)),
      messageCount: messages.length,
    },
    messages,
    model: { provider: metadata.provider, modelId: model },
  };
}

async function scanCodexFile(filePath: string): Promise<ExternalSessionDescriptor> {
  const times = await fileTimes(filePath);
  const filename = path.basename(filePath, ".jsonl");
  const fallbackId = filename.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu,
  )?.[1];
  const records: Record<string, unknown>[] = [];
  let hasMetadata = false;
  let hasTitle = false;
  await readJsonl(
    filePath,
    (record) => {
      records.push(record);
      const value = payload(record);
      hasMetadata ||= record.type === "session_meta";
      hasTitle ||=
        record.type === "ai-title" ||
        (record.type === "response_item" &&
          value?.type === "message" &&
          value.role === "user" &&
          visibleCodexUserBlocks(value.content).length > 0) ||
        (record.type === "event_msg" && value?.type === "user_message");
    },
    { stop: (_record, count) => (hasMetadata && hasTitle) || count >= 2_000 },
  );
  const metadata = metadataFromRecords(records, fallbackId || filename, times.createdAt);
  const issue = await workspaceIssue(metadata.cwd);
  return {
    source: "codex",
    sourceSessionId: metadata.sourceSessionId,
    title: metadata.title,
    cwd: metadata.cwd,
    createdAt: metadata.createdAt,
    updatedAt: times.updatedAt,
    importable: issue === undefined,
    alreadyImported: false,
    ...(issue ? { issue } : {}),
  };
}

export class CodexSessionAdapter implements ExternalSessionSourceAdapter {
  readonly source = "codex" as const;
  private filesById = new Map<string, string>();

  async scan(): Promise<ExternalSessionSourceSnapshot> {
    const root = codexRoot();
    const files = await jsonlFiles(root);
    if (files.length === 0) return { source: this.source, status: "not-found", sessions: [] };
    const settled = await mapSettledWithConcurrency(files, 8, scanCodexFile);
    const sessions: ExternalSessionDescriptor[] = [];
    this.filesById.clear();
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index];
      if (result.status === "fulfilled") {
        sessions.push(result.value);
        this.filesById.set(result.value.sourceSessionId, files[index]);
      }
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
      const value = payload(record);
      if (
        record.type === "session_meta" ||
        record.type === "turn_context" ||
        record.type === "ai-title" ||
        (record.type === "response_item" &&
          (value?.type === "message" ||
            value?.type === "reasoning" ||
            value?.type === "custom_tool_call" ||
            value?.type === "custom_tool_call_output")) ||
        (record.type === "event_msg" && value?.type === "user_message")
      ) {
        records.push(record);
      }
    });
    return parseCodexRecords(records, sourceSessionId, times.createdAt);
  }
}
