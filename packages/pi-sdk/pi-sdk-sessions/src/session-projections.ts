import { existsSync, statSync } from "node:fs";

import {
  sessionEntryToContextMessages,
  type SessionInfo,
  type SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

import type {
  PiAgentMessage,
  PiEvent,
  PiImageContent,
  PiQueuedPrompt,
  PiRunTiming,
  PiSessionHistory,
  PiSessionSummary,
  PiToolCallTiming,
} from "@workbench/pi-rpc-contracts/messages";
import {
  AUTOMATION_SESSION_ORIGIN_CUSTOM_TYPE,
  parseAutomationSessionOrigin,
  type AutomationSessionOrigin,
} from "@workbench/automation-contracts";
import { isWorkbenchComposerCommandResponseCustomType } from "@workbench/core-contracts/composer/request";
import { WORKBENCH_FILE_CHANGE_SET_CUSTOM_TYPE } from "@workbench/agent-runtime-contracts/file-changes";

import type { SessionEvent, SessionResumeState } from "@workbench/pi-rpc-contracts/rpc";
import {
  missingSessionResumeCheckpointFromBranch,
  SESSION_RESUME_CHECKPOINT_CUSTOM_TYPE,
  sessionResumeStateFromBranch,
} from "./session-resume";
import { deriveSessionDisplayTitle } from "@workbench/pi-runtime-adapters/sessions";
import { SESSION_TITLE_ORIGIN_CUSTOM_TYPE, sessionTitleOriginMarker } from "./session-title";
import {
  MANAGED_IMAGE_MEDIA_TYPES,
  type ManagedFileAttachment,
  type ManagedImageAttachment,
} from "@workbench/agent-runtime-contracts/composer-attachments";
import {
  type SessionMessageDelta,
  type SessionMessageMetadata,
} from "@workbench/pi-rpc-contracts/stream";

import { PiServerError } from "@workbench/pi-sdk-ports/errors";

import {
  SESSION_EVENT_CUSTOM_TYPE,
  SESSION_EVENT_JOURNAL_CUSTOM_TYPE,
} from "./session-event-journal";

import { workspaceFromCwd } from "@workbench/pi-sdk-resources/workspace-paths";

import {
  type PromptQueueSnapshot,
  type ReadonlyPromptQueueSnapshot,
  type SessionTimestampEntry,
  type SessionTimestampSource,
  type SessionOrigins,
} from "./session-types";
export function agentMessageText(value: unknown): string {
  if (!isRecord(value)) return "";
  const content = value.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [],
    )
    .join("\n");
}
export function assistantUpdateHasOutput(event: PiEvent): boolean {
  const update = isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : undefined;
  const hasDelta =
    (update?.type === "text_delta" || update?.type === "thinking_delta") &&
    typeof update.delta === "string" &&
    update.delta.length > 0;
  return hasDelta || assistantMessageHasOutput(event.message);
}
export function assistantMessageHasOutput(value: unknown): boolean {
  if (!isRecord(value) || value.role !== "assistant" || !Array.isArray(value.content)) {
    return false;
  }
  return value.content.some(
    (part) =>
      isRecord(part) &&
      ((part.type === "text" && typeof part.text === "string" && part.text.length > 0) ||
        (part.type === "thinking" &&
          part.redacted !== true &&
          typeof part.thinking === "string" &&
          part.thinking.length > 0)),
  );
}
export function assistantMessageMetadata(value: unknown): SessionMessageMetadata | undefined {
  if (!isRecord(value) || value.role !== "assistant" || !Array.isArray(value.content)) {
    return undefined;
  }
  const { content: _content, ...metadata } = value;
  return {
    ...metadata,
    ...(isRecord(metadata.usage) ? { usage: { ...metadata.usage } } : {}),
    ...(Array.isArray(metadata.diagnostics)
      ? {
          diagnostics: metadata.diagnostics.map((diagnostic) =>
            isRecord(diagnostic) ? { ...diagnostic } : diagnostic,
          ),
        }
      : {}),
  } as SessionMessageMetadata;
}
export function appendPackedAssistantUpdate(
  updates: SessionMessageDelta[],
  update: SessionMessageDelta,
): void {
  const previous = updates.at(-1);
  if (
    previous &&
    (update.type === "text_delta" ||
      update.type === "thinking_delta" ||
      update.type === "toolcall_delta") &&
    previous.type === update.type &&
    previous.contentIndex === update.contentIndex
  ) {
    previous.delta += update.delta;
    return;
  }
  updates.push(update);
}
export function customMessageMatchesEntry(
  message: Record<string, unknown>,
  entry: SessionEntry | undefined,
): boolean {
  return (
    entry?.type === "custom_message" &&
    entry.customType === message.customType &&
    jsonEqual(entry.content, message.content) &&
    entry.display === message.display &&
    jsonEqual(entry.details, message.details)
  );
}
export function isNativeImageAttachment(
  attachment: ManagedFileAttachment,
): attachment is ManagedImageAttachment {
  return MANAGED_IMAGE_MEDIA_TYPES.some((mediaType) => mediaType === attachment.mediaType);
}
export function jsonEqual(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}
export function compactAssistantMessageUpdate(event: PiEvent): SessionMessageDelta | undefined {
  const source = isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : undefined;
  if (!source || !Number.isInteger(source.contentIndex) || (source.contentIndex as number) < 0) {
    return undefined;
  }
  const contentIndex = source.contentIndex as number;
  const part = assistantMessagePart(event.message, contentIndex);
  switch (source.type) {
    case "text_start":
      return { type: "text_start", contentIndex };
    case "text_delta":
      return typeof source.delta === "string"
        ? { type: "text_delta", contentIndex, delta: source.delta }
        : undefined;
    case "text_end":
      return typeof source.content === "string"
        ? {
            type: "text_end",
            contentIndex,
            content: source.content,
            ...(typeof part?.textSignature === "string"
              ? { contentSignature: part.textSignature }
              : {}),
          }
        : undefined;
    case "thinking_start":
      return { type: "thinking_start", contentIndex };
    case "thinking_delta":
      return typeof source.delta === "string"
        ? { type: "thinking_delta", contentIndex, delta: source.delta }
        : undefined;
    case "thinking_end":
      return typeof source.content === "string"
        ? {
            type: "thinking_end",
            contentIndex,
            content: source.content,
            ...(typeof part?.thinkingSignature === "string"
              ? { contentSignature: part.thinkingSignature }
              : {}),
            ...(typeof part?.redacted === "boolean" ? { redacted: part.redacted } : {}),
          }
        : undefined;
    case "toolcall_start":
      return part?.type === "toolCall" &&
        typeof part.id === "string" &&
        typeof part.name === "string"
        ? { type: "toolcall_start", contentIndex, id: part.id, toolName: part.name }
        : undefined;
    case "toolcall_delta":
      return typeof source.delta === "string"
        ? { type: "toolcall_delta", contentIndex, delta: source.delta }
        : undefined;
    case "toolcall_end": {
      const toolCall = compactToolCall(source.toolCall ?? part);
      return toolCall ? { type: "toolcall_end", contentIndex, toolCall } : undefined;
    }
    default:
      return undefined;
  }
}
export function copyQueueSnapshot(queue: ReadonlyPromptQueueSnapshot): PromptQueueSnapshot {
  return {
    steering: copyQueuedPrompts(queue.steering),
    followUp: copyQueuedPrompts(queue.followUp),
  };
}
export function copyQueuedPrompts(prompts: readonly PiQueuedPrompt[]): PiQueuedPrompt[] {
  return prompts.map((prompt) => ({
    message: prompt.message,
    ...(prompt.fileAttachmentIds?.length
      ? { fileAttachmentIds: [...prompt.fileAttachmentIds] }
      : {}),
    ...(prompt.fileAttachments?.length
      ? { fileAttachments: prompt.fileAttachments.map((attachment) => ({ ...attachment })) }
      : {}),
    ...(prompt.textAttachmentIds?.length
      ? { textAttachmentIds: [...prompt.textAttachmentIds] }
      : {}),
    ...(prompt.textAttachments?.length ? { textAttachments: prompt.textAttachments } : {}),
    ...(prompt.sourceText === undefined ? {} : { sourceText: prompt.sourceText }),
    ...(prompt.images?.length ? { images: prompt.images.map((image) => ({ ...image })) } : {}),
    ...(prompt.imageDelivery === undefined ? {} : { imageDelivery: prompt.imageDelivery }),
  }));
}
export function hasUnmanagedImages(images: readonly PiImageContent[] | undefined): boolean {
  return images?.some((image) => !image.attachment && !image.attachmentId) ?? false;
}
export function imageUnsupported(): PiServerError {
  return new PiServerError("pi_model_image_unsupported", 400);
}
export function legacySessionEventsFromManager(manager: SessionManager): SessionEvent[] {
  const history = historyFromManager(manager);
  return history.context.messages.map((message, seq) => ({
    type: "message",
    seq,
    time: historyEventTime(message, history.context.entryCompletedAts?.[seq]),
    data: message,
  }));
}
export function managedFileTrailingText(files: readonly ManagedFileAttachment[]): string[] {
  return files.flatMap((attachment) => [
    `[Attached ${attachment.mediaType}: ${attachment.name}]`,
    `[File: source: ${attachment.path}]`,
  ]);
}
export function managedImageTrailingText(
  images: readonly PiImageContent[],
  supportsImages: boolean,
): string[] {
  return images.flatMap((image) => {
    const attachment = image.attachment;
    if (!attachment) return [];
    const source = `[Image: source: ${attachment.path}]`;
    return supportsImages
      ? [source]
      : [
          `[Attached ${attachment.mediaType}: ${attachment.name}] [Media omitted from provider request because the selected model does not support image input.]`,
          source,
        ];
  });
}
export function nativeImagesForModel(
  images: readonly PiImageContent[] | undefined,
  model: { input: readonly string[] } | undefined,
  delivery?: PiQueuedPrompt["imageDelivery"],
): PiImageContent[] | undefined {
  if (!images?.length) return undefined;
  if (delivery === "path") return hasUnmanagedImages(images) ? [...images] : undefined;
  if (delivery === "native")
    return images.map(
      ({ attachment: _attachment, attachmentId: _attachmentId, ...image }) => image,
    );
  if (!model?.input.includes("image")) {
    return hasUnmanagedImages(images) ? [...images] : undefined;
  }
  return images.map(({ attachment: _attachment, attachmentId: _attachmentId, ...image }) => image);
}
export function promptsHaveImages(prompts: ReadonlyPromptQueueSnapshot): boolean {
  return [...prompts.steering, ...prompts.followUp].some(
    (prompt) => prompt.imageDelivery === "native" || hasUnmanagedImages(prompt.images),
  );
}
export function resumeStateFromManager(
  manager: SessionManager,
  events: readonly SessionEvent[],
): SessionResumeState {
  const model = manager.buildSessionContext().model;
  const currentModel = model ? { provider: model.provider, model: model.modelId } : undefined;
  let resumeState = sessionResumeStateFromBranch(manager.getBranch(), currentModel);
  if (resumeState.checkpoint) return resumeState;
  const candidate = missingSessionResumeCheckpointFromBranch(
    manager.getBranch(),
    events,
    currentModel,
  );
  if (!candidate) return resumeState;
  try {
    manager.appendCustomEntry(SESSION_RESUME_CHECKPOINT_CUSTOM_TYPE, candidate.value);
    resumeState = sessionResumeStateFromBranch(manager.getBranch(), currentModel);
  } catch {
    // History remains readable even if an old session cannot be repaired in place.
  }
  return resumeState;
}
export function sessionManagerInfo(
  manager: SessionManager,
  summary: PiSessionSummary,
): SessionInfo | undefined {
  const sessionFile = manager.getSessionFile();
  if (!sessionFile || !existsSync(sessionFile)) return undefined;
  const header = manager.getHeader();
  return {
    path: sessionFile,
    id: summary.id,
    cwd: summary.cwd,
    ...(summary.name === undefined ? {} : { name: summary.name }),
    ...(header?.parentSession === undefined ? {} : { parentSessionPath: header.parentSession }),
    created: new Date(summary.created),
    modified: new Date(summary.modified),
    messageCount: summary.messageCount,
    firstMessage: summary.firstMessage,
    allMessagesText: sessionManagerSearchText(manager),
  };
}
export function sessionManagerSummary(
  manager: SessionManager,
  running: boolean,
  runTiming?: PiRunTiming,
): PiSessionSummary {
  const context = manager.buildSessionContext();
  const header = manager.getHeader();
  const file = manager.getSessionFile();
  const timestamp = header?.timestamp ?? new Date().toISOString();
  const { automationOrigin } = sessionOriginsFromEntries(manager.getEntries());
  return {
    id: manager.getSessionId(),
    cwd: manager.getCwd(),
    workspace: workspaceFromCwd(manager.getCwd()),
    name: manager.getSessionName(),
    created: timestamp,
    modified: sessionModifiedAt(manager).toISOString(),
    messageCount: context.messages.length,
    firstMessage: firstUserText(context.messages),
    transient: !file || !existsSync(file),
    running,
    ...(runTiming === undefined ? {} : { runTiming }),
    ...(automationOrigin === undefined ? {} : { automationOrigin }),
  };
}
export function textOnlyModelContext(messages: readonly unknown[]): readonly unknown[] {
  let imageSequence = 0;
  let changed = false;
  const next = messages.map((candidate) => {
    if (!isRecord(candidate) || !Array.isArray(candidate.content)) return candidate;
    let messageChanged = false;
    const content = candidate.content.map((part) => {
      if (!isRecord(part) || part.type !== "image" || typeof part.data !== "string") return part;
      imageSequence += 1;
      changed = true;
      messageChanged = true;
      return {
        type: "text",
        text: `${HISTORICAL_IMAGE_OMISSION_PREFIX} ${imageSequence} because the current model accepts text only.]`,
      };
    });
    return messageChanged ? { ...candidate, content } : candidate;
  });
  return changed ? next : messages;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function assistantMessagePart(
  message: unknown,
  contentIndex: number,
): Record<string, unknown> | undefined {
  if (!isRecord(message) || !Array.isArray(message.content)) return undefined;
  const part = message.content[contentIndex];
  return isRecord(part) ? part : undefined;
}
export function compactToolCall(
  value: unknown,
): Extract<SessionMessageDelta, { type: "toolcall_end" }>["toolCall"] | undefined {
  if (
    !isRecord(value) ||
    value.type !== "toolCall" ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !isRecord(value.arguments)
  ) {
    return undefined;
  }
  return {
    type: "toolCall",
    id: value.id,
    name: value.name,
    arguments: value.arguments,
    ...(typeof value.thoughtSignature === "string"
      ? { thoughtSignature: value.thoughtSignature }
      : {}),
    ...(typeof value.namespace === "string" ? { namespace: value.namespace } : {}),
  };
}
export function historyFromManager(manager: SessionManager): PiSessionHistory {
  const context = manager.buildSessionContext();
  const messages: PiAgentMessage[] = [];
  const entryIds: string[] = [];
  const entryCompletedAts: Array<number | null> = [];
  const toolTimings: PiToolCallTiming[] = [];
  for (const entry of manager.getBranch()) {
    if (entry.type !== "custom") continue;
    if (entry.customType === TOOL_TIMING_CUSTOM_TYPE) {
      if (!entry.data || typeof entry.data !== "object") continue;
      const timing = entry.data as Partial<PiToolCallTiming>;
      if (
        typeof timing.toolCallId !== "string" ||
        typeof timing.startedAt !== "number" ||
        !Number.isFinite(timing.startedAt) ||
        typeof timing.completedAt !== "number" ||
        !Number.isFinite(timing.completedAt) ||
        timing.completedAt < timing.startedAt
      ) {
        continue;
      }
      toolTimings.push({
        toolCallId: timing.toolCallId,
        startedAt: timing.startedAt,
        completedAt: timing.completedAt,
      });
    }
  }
  for (const entry of manager.buildContextEntries()) {
    const projectedMessages =
      entry.type === "custom" && isWorkbenchDisplayOnlyCustomType(entry.customType)
        ? [
            {
              role: "custom" as const,
              customType: entry.customType,
              content: "",
              display: true,
              details: entry.data,
              timestamp: Date.parse(entry.timestamp),
            },
          ]
        : (sessionEntryToContextMessages(entry) as PiAgentMessage[]);
    const completedAt = Date.parse(entry.timestamp);
    for (const message of projectedMessages) {
      messages.push(message);
      entryIds.push(entry.id);
      entryCompletedAts.push(Number.isFinite(completedAt) ? completedAt : null);
    }
  }
  return {
    sessionId: manager.getSessionId(),
    context: {
      // Response.json performs the required serialization. Avoiding an additional
      // stringify/parse pass here matters for multi-megabyte conversation histories.
      messages,
      entryIds,
      entryCompletedAts,
      toolTimings,
      thinkingLevel: context.thinkingLevel,
      model: context.model,
    },
  };
}
export function historyEventTime(
  message: PiAgentMessage,
  completedAt: number | null | undefined,
): number {
  if (typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) {
    return message.timestamp;
  }
  return typeof completedAt === "number" && Number.isFinite(completedAt) ? completedAt : 0;
}
export function sessionManagerSearchText(manager: SessionManager): string {
  return manager
    .getEntries()
    .filter((entry) => entry.type === "message")
    .map((entry) => searchableMessageText(entry.message))
    .filter(Boolean)
    .join(" ");
}
export function sessionOriginsFromEntries(entries: readonly SessionEntry[]): SessionOrigins {
  let automationOrigin: AutomationSessionOrigin | undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "custom") continue;
    if (!automationOrigin && entry.customType === AUTOMATION_SESSION_ORIGIN_CUSTOM_TYPE) {
      automationOrigin = parseAutomationSessionOrigin(entry.data);
    }
    if (automationOrigin) break;
  }
  return automationOrigin === undefined ? {} : { automationOrigin };
}
export function sessionModifiedAt(source: SessionTimestampSource): Date {
  const branch = source.getBranch();
  const generatedTitleInfoIds = new Set(
    branch.flatMap((entry) => {
      const marker = sessionTitleOriginMarker(entry);
      return marker?.origin === "generated" && entry.parentId ? [entry.parentId] : [];
    }),
  );
  let expectedSequence = 0;
  let modifiedTime: number | undefined;
  for (const entry of branch) {
    const canonical = storedCanonicalEvent(entry);
    if (canonical?.seq === expectedSequence) {
      expectedSequence += 1;
      modifiedTime = Math.max(modifiedTime ?? Number.NEGATIVE_INFINITY, canonical.time);
    }
    const meaningful =
      (entry.type === "session_info" &&
        entry.id !== undefined &&
        generatedTitleInfoIds.has(entry.id)) ||
      (entry.type === "custom" && entry.customType === SESSION_TITLE_ORIGIN_CUSTOM_TYPE)
        ? undefined
        : meaningfulEntryTime(entry);
    if (meaningful) {
      modifiedTime = Math.max(modifiedTime ?? Number.NEGATIVE_INFINITY, meaningful.getTime());
    }
  }
  if (modifiedTime !== undefined) return new Date(modifiedTime);

  const headerTimestamp = parsedDate(source.getHeader()?.timestamp);
  if (headerTimestamp) return headerTimestamp;

  const file = source.getSessionFile();
  if (file) {
    try {
      return statSync(file).mtime;
    } catch {
      // A transient or newly-created session can disappear before the stat call.
    }
  }
  return new Date();
}
export function firstUserText(messages: readonly unknown[]): string {
  for (const candidate of messages) {
    if (!candidate || typeof candidate !== "object") continue;
    const message = candidate as { role?: unknown; content?: unknown };
    if (message.role !== "user") continue;
    if (typeof message.content === "string" && message.content.trim()) {
      const title = deriveSessionDisplayTitle(message.content);
      if (title) return title;
    }
    if (!Array.isArray(message.content)) continue;
    const text = message.content
      .filter((part): part is { type: "text"; text: string } =>
        Boolean(
          part &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string",
        ),
      )
      .map((part) => part.text)
      .join("\n");
    if (text?.trim()) {
      const title = deriveSessionDisplayTitle(text);
      if (title) return title;
    }
  }
  return "";
}
export const HISTORICAL_IMAGE_OMISSION_PREFIX = "[Workbench omitted historical image";
export const TOOL_TIMING_CUSTOM_TYPE = "workbench.tool-timing.v1";
export function isWorkbenchDisplayOnlyCustomType(customType: string): boolean {
  return (
    isWorkbenchComposerCommandResponseCustomType(customType) ||
    customType === WORKBENCH_FILE_CHANGE_SET_CUSTOM_TYPE
  );
}
export function searchableMessageText(candidate: unknown): string {
  if (!isRecord(candidate) || (candidate.role !== "user" && candidate.role !== "assistant")) {
    return "";
  }
  if (typeof candidate.content === "string") return candidate.content;
  if (!Array.isArray(candidate.content)) return "";
  return candidate.content
    .filter(
      (part): part is { type: "text"; text: string } =>
        isRecord(part) && part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join(" ");
}
export function storedCanonicalEvent(entry: SessionTimestampEntry): SessionEvent | undefined {
  if (entry.type !== "custom" || entry.customType !== SESSION_EVENT_CUSTOM_TYPE) {
    return undefined;
  }
  if (!isRecord(entry.data) || entry.data.version !== 1 || !isRecord(entry.data.event)) {
    return undefined;
  }
  const event = entry.data.event;
  if (
    typeof event.type !== "string" ||
    !event.type ||
    !Number.isInteger(event.seq) ||
    (event.seq as number) < 0 ||
    typeof event.time !== "number" ||
    !Number.isFinite(event.time) ||
    !Object.hasOwn(event, "data")
  ) {
    return undefined;
  }
  return event as unknown as SessionEvent;
}
export function meaningfulEntryTime(entry: SessionTimestampEntry): Date | undefined {
  if (
    entry.type === "custom" &&
    (entry.customType === SESSION_EVENT_CUSTOM_TYPE ||
      entry.customType === SESSION_EVENT_JOURNAL_CUSTOM_TYPE)
  ) {
    return undefined;
  }
  if (entry.type === "message" && isRecord(entry.message)) {
    const messageTimestamp = entry.message.timestamp;
    if (typeof messageTimestamp === "number" && Number.isFinite(messageTimestamp)) {
      return new Date(messageTimestamp);
    }
  }
  return parsedDate(entry.timestamp);
}
export function parsedDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : undefined;
}
