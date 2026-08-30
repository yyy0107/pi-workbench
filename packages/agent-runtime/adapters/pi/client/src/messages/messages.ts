import type {
  AppendMessage,
  ImageMessagePart,
  MessageTiming,
  ThreadAssistantMessage,
  ThreadMessage,
  ThreadUserMessage,
  ToolCallMessagePart,
  ToolCallTiming,
} from "@assistant-ui/react";

import {
  parseAttachmentRecognitionSnapshot,
  reconcileAttachmentRecognitionSnapshot,
  reduceAttachmentRecognitionSnapshot,
  WORKBENCH_ATTACHMENT_RECOGNITION_CUSTOM_TYPE,
  WORKBENCH_ATTACHMENT_RECOGNITION_DATA_NAME,
  WORKBENCH_IMAGE_RECOGNITION_CUSTOM_TYPE,
  WORKBENCH_IMAGE_RECOGNITION_DATA_NAME,
  type AttachmentRecognitionSnapshot,
} from "@workbench/attachment-understanding-contracts/state-machine";

import {
  isWorkbenchComposerCommandResponseCustomType,
  isWorkbenchComposerResolutionCustomType,
  isWorkbenchComposerUserCustomType,
  parseWorkbenchPromptFailureDetails,
  parseWorkbenchComposerSubmission,
  parseWorkbenchComposerCommandResponseDetails,
  parseWorkbenchComposerResolutionDetails,
  parseWorkbenchComposerUserDetails,
  workbenchComposerSubmissionFromRunConfig,
  WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE,
  WORKBENCH_PROMPT_FAILURE_CUSTOM_TYPE,
} from "@workbench/contracts/composer/request";
import type {
  WorkbenchComposerCommandResponseDetails,
  WorkbenchPromptFailureDetails,
  WorkbenchComposerSubmission,
} from "@workbench/contracts/composer/request";

import type {
  PiAgentMessage,
  PiAssistantMessage,
  PiDocumentContent,
  PiImageContent,
  PiModelChangeConversationEvent,
  PiSessionHistory,
  PiToolResultMessage,
  PiUserMessage,
} from "@workbench/agent-runtime-pi-protocol/messages";
import { stripWorkspaceFeedbackContext } from "@workbench/agent-runtime-client/prompt-feedback";
import { PI_CONVERSATION_EVENT_CUSTOM_TYPE } from "@workbench/agent-runtime-pi-protocol/messages";
import {
  parsePiContextTraceData,
  piContextTraceData,
  WORKBENCH_PI_CONTEXT_TRACE_DATA_NAME,
} from "../context-trace/data-part";
import type {
  SessionContextTraceEventSummary,
  SessionContextTracePromptPart,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import { terminationFromAssistantMessage } from "@workbench/agent-runtime-pi-shared/messages";
import type { PiMessageTermination } from "@workbench/agent-runtime-pi-shared/messages";

import { parsePiConversationEvent, projectPiConversationEvent } from "./conversation-events";
import type { PiUsageMetadata } from "./pi-usage";
import { aggregatePiTurnStatistics } from "./session-statistics";

function messageDate(timestamp: number | undefined, index: number): Date {
  return new Date(timestamp ?? index);
}

function metadata(custom: Record<string, unknown> = {}) {
  return { custom };
}

function isRecognitionDataName(name: string): boolean {
  return (
    name === WORKBENCH_ATTACHMENT_RECOGNITION_DATA_NAME ||
    name === WORKBENCH_IMAGE_RECOGNITION_DATA_NAME
  );
}

function isPiContextTracePart(part: ThreadAssistantMessage["content"][number]): boolean {
  return part.type === "data" && part.name === WORKBENCH_PI_CONTEXT_TRACE_DATA_NAME;
}

function piContextTraceId(part: ThreadAssistantMessage["content"][number]): string | undefined {
  if (!isPiContextTracePart(part) || part.type !== "data") return undefined;
  return parsePiContextTraceData(part.data)?.event.traceId;
}

function isPiContextTracePromptPart(part: ThreadAssistantMessage["content"][number]): boolean {
  if (!isPiContextTracePart(part) || part.type !== "data") return false;
  return parsePiContextTraceData(part.data)?.event.kind === "prompt-composition";
}

export function appendPiContextTraceAssistantPart(
  message: ThreadAssistantMessage,
  event: SessionContextTraceEventSummary,
): ThreadAssistantMessage {
  if (event.kind !== "prompt-composition") return message;
  if (message.content.some((part) => piContextTraceId(part) === event.traceId)) return message;
  const part = {
    type: "data" as const,
    name: WORKBENCH_PI_CONTEXT_TRACE_DATA_NAME,
    data: piContextTraceData(event),
  };
  return {
    ...message,
    content: [part, ...message.content],
  };
}

/**
 * Prompt composition describes the input to the assistant turn, so it always precedes Pi-native
 * response parts. Network arrival order must not move this semantic prelude below response text.
 */
export function reconcilePiContextTraceAssistantParts(
  message: ThreadAssistantMessage,
  previous: ThreadAssistantMessage,
): ThreadAssistantMessage {
  const promptParts: ThreadAssistantMessage["content"][number][] = [];
  const seen = new Set<string>();
  for (const part of [...previous.content, ...message.content]) {
    const traceId = piContextTraceId(part);
    if (traceId) {
      if (isPiContextTracePromptPart(part) && !seen.has(traceId)) {
        promptParts.push(part);
      }
      seen.add(traceId);
    }
  }
  if (promptParts.length === 0) return message;
  return {
    ...message,
    content: [...promptParts, ...message.content.filter((part) => !isPiContextTracePart(part))],
  };
}

function assistantMessageTimestamp(message: ThreadAssistantMessage): number | undefined {
  const value = message.metadata.custom.piMessageTimestamp;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Retains live trace Parts when an authoritative Pi history refresh replaces the same message. */
export function mergePiContextTracePartsFromMessages(
  messages: readonly ThreadMessage[],
  previousMessages: readonly ThreadMessage[],
): ThreadMessage[] {
  const previousByTimestamp = new Map<number, ThreadAssistantMessage>();
  for (const candidate of previousMessages) {
    if (candidate.role !== "assistant" || !candidate.content.some(isPiContextTracePromptPart)) {
      continue;
    }
    const timestamp = assistantMessageTimestamp(candidate);
    if (timestamp !== undefined) previousByTimestamp.set(timestamp, candidate);
  }
  if (previousByTimestamp.size === 0) return messages as ThreadMessage[];

  let changed = false;
  const projected = messages.map((message) => {
    if (message.role !== "assistant") return message;
    const timestamp = assistantMessageTimestamp(message);
    const previous = timestamp === undefined ? undefined : previousByTimestamp.get(timestamp);
    if (!previous) return message;
    changed = true;
    return reconcilePiContextTraceAssistantParts(message, previous);
  });
  return changed ? projected : (messages as ThreadMessage[]);
}

/** Rehydrates durable prompt-composition summaries before their owning Pi message content. */
export function projectPiContextTracePromptParts(
  messages: readonly ThreadMessage[],
  promptParts: readonly SessionContextTracePromptPart[],
): ThreadMessage[] {
  const eventsByTimestamp = new Map<number, SessionContextTraceEventSummary[]>();
  for (const part of promptParts) {
    if (part.event.kind !== "prompt-composition" || part.assistantMessageTimestamp === undefined) {
      continue;
    }
    const events = eventsByTimestamp.get(part.assistantMessageTimestamp) ?? [];
    events.push(part.event);
    eventsByTimestamp.set(part.assistantMessageTimestamp, events);
  }
  if (eventsByTimestamp.size === 0) return messages as ThreadMessage[];

  let changed = false;
  const projected = messages.map((message) => {
    if (message.role !== "assistant") return message;
    const timestamp = assistantMessageTimestamp(message);
    const events = timestamp === undefined ? undefined : eventsByTimestamp.get(timestamp);
    if (!events?.length) return message;

    const existingTraceIds = new Set(
      message.content.flatMap((part) => {
        const traceId = piContextTraceId(part);
        return traceId ? [traceId] : [];
      }),
    );
    const traceContent = events.flatMap((event) =>
      existingTraceIds.has(event.traceId)
        ? []
        : [
            {
              type: "data" as const,
              name: WORKBENCH_PI_CONTEXT_TRACE_DATA_NAME,
              data: piContextTraceData(event),
            },
          ],
    );
    if (traceContent.length === 0) return message;
    changed = true;
    return { ...message, content: [...traceContent, ...message.content] };
  });
  return changed ? projected : (messages as ThreadMessage[]);
}

export function isPiContextTraceOnlyAssistant(message: ThreadMessage): boolean {
  return (
    message.role === "assistant" &&
    message.content.some(isPiContextTracePart) &&
    message.content.every(
      (part) => isPiContextTracePart(part) || (part.type === "text" && part.text === ""),
    )
  );
}

function attachmentRecognitionMetadata(message: ThreadMessage): unknown {
  return (
    message.metadata.custom.workbenchAttachmentRecognition ??
    message.metadata.custom.workbenchImageRecognition
  );
}

export function attachmentRecognitionSubmissionIdFromMessage(
  message: ThreadMessage,
): string | undefined {
  const value =
    message.metadata.custom.workbenchAttachmentRecognitionSubmissionId ??
    message.metadata.custom.workbenchImageRecognitionSubmissionId;
  return typeof value === "string" ? value : undefined;
}

export function attachmentRecognitionSnapshotFromMessage(
  message: ThreadMessage,
): AttachmentRecognitionSnapshot | undefined {
  const part = message.content.find(
    (candidate) => candidate.type === "data" && isRecognitionDataName(candidate.name),
  );
  if (part?.type === "data") return parseAttachmentRecognitionSnapshot(part.data);
  return parseAttachmentRecognitionSnapshot(attachmentRecognitionMetadata(message));
}

function attachmentRecognitionMessageStatus(
  snapshot: AttachmentRecognitionSnapshot,
): ThreadAssistantMessage["status"] {
  switch (snapshot.status) {
    case "pending":
    case "running":
      return { type: "running" };
    case "cancelled":
      return { type: "incomplete", reason: "cancelled" };
    case "failed":
      return { type: "incomplete", reason: "error", error: snapshot.errorCode };
    case "succeeded":
    case "skipped":
      return { type: "complete", reason: "unknown" };
  }
}

function attachmentRecognitionTermination(
  snapshot: AttachmentRecognitionSnapshot,
): PiMessageTermination | undefined {
  if (snapshot.status === "cancelled") {
    return {
      schemaVersion: 1,
      kind: "cancelled",
      stopReason: "aborted",
      source: "workbench",
    };
  }
  if (snapshot.status === "failed") {
    return {
      schemaVersion: 1,
      kind: "provider-error",
      stopReason: "error",
      errorMessage: snapshot.errorCode,
      source: "workbench",
    };
  }
  return undefined;
}

function attachmentRecognitionTurnTiming(
  snapshot: AttachmentRecognitionSnapshot,
): { startedAt: number; completedAt: number } | undefined {
  const startedAt = snapshot.timestamps?.createdAt;
  const completedAt = snapshot.timestamps?.completedAt;
  return startedAt !== undefined &&
    completedAt !== undefined &&
    Number.isFinite(startedAt) &&
    Number.isFinite(completedAt) &&
    completedAt >= startedAt
    ? { startedAt, completedAt }
    : undefined;
}

function attachmentRecognitionLifecycleMetadata(snapshot: AttachmentRecognitionSnapshot) {
  const termination = attachmentRecognitionTermination(snapshot);
  const turnTiming = attachmentRecognitionTurnTiming(snapshot);
  return {
    ...(termination === undefined ? {} : { piTermination: termination }),
    ...(termination === undefined ? {} : { workbenchTermination: termination }),
    ...(turnTiming === undefined ? {} : { piTurnTiming: turnTiming }),
    ...(turnTiming === undefined ? {} : { workbenchTurnTiming: turnTiming }),
  };
}

export function attachmentRecognitionAssistantMessage(
  snapshot: AttachmentRecognitionSnapshot,
): ThreadAssistantMessage {
  return {
    id: `workbench-attachment-recognition:${snapshot.operationId}`,
    role: "assistant",
    content: [{ type: "data", name: WORKBENCH_ATTACHMENT_RECOGNITION_DATA_NAME, data: snapshot }],
    status: attachmentRecognitionMessageStatus(snapshot),
    createdAt: new Date(snapshot.timestamps?.createdAt ?? 0),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {
        workbenchAttachmentRecognition: snapshot,
        workbenchAttachmentRecognitionOnly: true,
        workbenchAttachmentRecognitionSubmissionId: snapshot.submissionId,
        ...(snapshot.rpcId === undefined ? {} : { workbenchPromptRpcId: snapshot.rpcId }),
        ...attachmentRecognitionLifecycleMetadata(snapshot),
      },
    },
  };
}

/**
 * Recognition can be cancelled before Pi has a canonical user message to regenerate from. In
 * that case the durable Composer marker is the retry source understood by the server.
 */
export function isAttachmentRecognitionRetrySource(message: ThreadUserMessage): boolean {
  return (
    attachmentRecognitionSnapshotFromMessage(message)?.status === "cancelled" &&
    parseWorkbenchComposerSubmission(message.metadata.custom.workbenchComposerSubmission) !==
      undefined
  );
}

export function isAttachmentRecognitionOnlyAssistant(message: ThreadMessage): boolean {
  return (
    message.role === "assistant" &&
    (message.metadata.custom.workbenchAttachmentRecognitionOnly === true ||
      message.metadata.custom.workbenchImageRecognitionOnly === true) &&
    message.content.length > 0 &&
    message.content.every((part) => part.type === "data" && isRecognitionDataName(part.name)) &&
    attachmentRecognitionSnapshotFromMessage(message) !== undefined
  );
}

function updateAttachmentRecognitionAssistantPart(
  message: ThreadAssistantMessage,
  incomingValue: unknown,
  mergeSnapshot: (
    current: AttachmentRecognitionSnapshot,
    incoming: AttachmentRecognitionSnapshot,
  ) => AttachmentRecognitionSnapshot,
): ThreadAssistantMessage {
  const incoming = parseAttachmentRecognitionSnapshot(incomingValue);
  if (!incoming) return message;
  const current = attachmentRecognitionSnapshotFromMessage(message);
  let next = incoming;
  if (current) {
    try {
      next = mergeSnapshot(current, incoming);
    } catch {
      return message;
    }
    if (next === current) return message;
  }
  const content = message.content.filter(
    (part) => part.type !== "data" || !isRecognitionDataName(part.name),
  );
  const recognitionOnly = isAttachmentRecognitionOnlyAssistant(message);
  const {
    piTermination: _previousTermination,
    piTurnTiming: _previousTurnTiming,
    workbenchTermination: _previousWorkbenchTermination,
    workbenchTurnTiming: _previousWorkbenchTurnTiming,
    ...customWithoutLifecycle
  } = message.metadata.custom;
  return {
    ...message,
    content: [
      { type: "data", name: WORKBENCH_ATTACHMENT_RECOGNITION_DATA_NAME, data: next },
      ...content,
    ],
    ...(recognitionOnly ? { status: attachmentRecognitionMessageStatus(next) } : {}),
    metadata: {
      ...message.metadata,
      custom: {
        ...(recognitionOnly ? customWithoutLifecycle : message.metadata.custom),
        workbenchAttachmentRecognition: next,
        workbenchAttachmentRecognitionSubmissionId: next.submissionId,
        ...(next.rpcId === undefined ? {} : { workbenchPromptRpcId: next.rpcId }),
        ...(recognitionOnly ? attachmentRecognitionLifecycleMetadata(next) : {}),
      },
    },
  };
}

export function upsertAttachmentRecognitionAssistantPart(
  message: ThreadAssistantMessage,
  incomingValue: unknown,
): ThreadAssistantMessage {
  return updateAttachmentRecognitionAssistantPart(
    message,
    incomingValue,
    reduceAttachmentRecognitionSnapshot,
  );
}

export function reconcileAttachmentRecognitionAssistantPart(
  message: ThreadAssistantMessage,
  incomingValue: unknown,
): ThreadAssistantMessage {
  return updateAttachmentRecognitionAssistantPart(
    message,
    incomingValue,
    reconcileAttachmentRecognitionSnapshot,
  );
}

export function withoutAttachmentRecognitionUserParts(
  messages: readonly ThreadMessage[],
): ThreadMessage[] {
  let changed = false;
  const updated = messages.map((message) => {
    if (message.role !== "user") return message;
    const content = message.content.filter(
      (part) => part.type !== "data" || !isRecognitionDataName(part.name),
    );
    if (content.length === message.content.length) return message;
    changed = true;
    return { ...message, content };
  });
  return changed ? updated : (messages as ThreadMessage[]);
}

function updateAttachmentRecognitionInMessages(
  messages: readonly ThreadMessage[],
  incomingValue: unknown,
  updatePart: (
    message: ThreadAssistantMessage,
    incoming: AttachmentRecognitionSnapshot,
  ) => ThreadAssistantMessage,
): ThreadMessage[] {
  const incoming = parseAttachmentRecognitionSnapshot(incomingValue);
  if (!incoming) return messages as ThreadMessage[];

  let updated = withoutAttachmentRecognitionUserParts(messages);
  const explicitAssistantIndex = updated.findIndex(
    (message) =>
      message.role === "assistant" &&
      (attachmentRecognitionSnapshotFromMessage(message)?.operationId === incoming.operationId ||
        attachmentRecognitionSubmissionIdFromMessage(message) === incoming.submissionId ||
        (incoming.rpcId !== undefined &&
          message.metadata.custom.workbenchPromptRpcId === incoming.rpcId)),
  );
  const userIndex = updated.findIndex(
    (message) =>
      message.role === "user" &&
      ((incoming.rpcId !== undefined &&
        message.metadata.custom.workbenchPromptRpcId === incoming.rpcId) ||
        message.metadata.custom.workbenchComposerSubmissionId === incoming.submissionId ||
        parseAttachmentRecognitionSnapshot(attachmentRecognitionMetadata(message))?.operationId ===
          incoming.operationId),
  );
  if (userIndex >= 0) {
    const user = updated[userIndex];
    if (user?.role === "user") {
      updated = [...updated];
      updated[userIndex] = {
        ...user,
        metadata: {
          ...user.metadata,
          custom: {
            ...user.metadata.custom,
            workbenchAttachmentRecognition: incoming,
          },
        },
      };
    }
  }

  let assistantIndex = explicitAssistantIndex;
  if (assistantIndex < 0 && userIndex >= 0) {
    const resolvedUser =
      updated[userIndex]?.metadata.custom.workbenchComposerProjectionResolved === true;
    if (resolvedUser) {
      for (let index = userIndex + 1; index < updated.length; index += 1) {
        const candidate = updated[index];
        if (candidate?.role === "user") break;
        if (candidate?.role === "assistant") {
          assistantIndex = index;
          break;
        }
      }
    }
  }

  if (assistantIndex >= 0) {
    const current = updated[assistantIndex];
    if (!current || current.role !== "assistant") return updated;
    const next = updatePart(current, incoming);
    if (next === current) return updated;
    if (updated === messages) updated = [...updated];
    updated[assistantIndex] = next;
    return updated;
  }

  if (userIndex < 0 || (incoming.status === "skipped" && incoming.method === "native")) {
    return updated;
  }
  const resolvedUser =
    updated[userIndex]?.metadata.custom.workbenchComposerProjectionResolved === true;
  const hasLaterUser = updated.some(
    (message, index) => index > userIndex && message.role === "user",
  );
  // An unresolved Composer marker normally stays at the chronological tail until Pi publishes
  // its canonical user event. If a later user turn already exists, however, this recognition
  // operation can no longer belong at the tail: doing so places the old status beside (and then
  // coalesces it into) the newer assistant response. Keep stale terminal/history updates anchored
  // to their originating user turn even when that turn never produced a canonical Pi user event.
  const insertionIndex = resolvedUser || hasLaterUser ? userIndex + 1 : updated.length;
  updated = [...updated];
  updated.splice(insertionIndex, 0, attachmentRecognitionAssistantMessage(incoming));
  return updated;
}

export function upsertAttachmentRecognitionInMessages(
  messages: readonly ThreadMessage[],
  incomingValue: unknown,
): ThreadMessage[] {
  return updateAttachmentRecognitionInMessages(
    messages,
    incomingValue,
    upsertAttachmentRecognitionAssistantPart,
  );
}

export function reconcileAttachmentRecognitionInMessages(
  messages: readonly ThreadMessage[],
  incomingValue: unknown,
): ThreadMessage[] {
  return updateAttachmentRecognitionInMessages(
    messages,
    incomingValue,
    reconcileAttachmentRecognitionAssistantPart,
  );
}

/** @deprecated Use the attachment-recognition name. */
export const imageRecognitionSnapshotFromMessage = attachmentRecognitionSnapshotFromMessage;
/** @deprecated Use the attachment-recognition name. */
export const imageRecognitionAssistantMessage = attachmentRecognitionAssistantMessage;
/** @deprecated Use the attachment-recognition name. */
export const isImageRecognitionOnlyAssistant = isAttachmentRecognitionOnlyAssistant;
/** @deprecated Use the attachment-recognition name. */
export const upsertImageRecognitionAssistantPart = upsertAttachmentRecognitionAssistantPart;
/** @deprecated Use the attachment-recognition name. */
export const reconcileImageRecognitionAssistantPart = reconcileAttachmentRecognitionAssistantPart;
/** @deprecated Use the attachment-recognition name. */
export const withoutImageRecognitionUserParts = withoutAttachmentRecognitionUserParts;
/** @deprecated Use the attachment-recognition name. */
export const upsertImageRecognitionInMessages = upsertAttachmentRecognitionInMessages;
/** @deprecated Use the attachment-recognition name. */
export const reconcileImageRecognitionInMessages = reconcileAttachmentRecognitionInMessages;

export function workbenchComposerCommandResponseId(
  response: Pick<WorkbenchComposerCommandResponseDetails, "submissionId" | "commandId">,
): string {
  return `workbench-command-response:${response.submissionId}:${response.commandId}`;
}

export function workbenchComposerCommandResponseThreadMessage(
  response: WorkbenchComposerCommandResponseDetails,
  timestamp: number,
): ThreadMessage {
  return {
    id: workbenchComposerCommandResponseId(response),
    role: "system",
    content: [{ type: "text", text: "" }],
    createdAt: new Date(timestamp),
    metadata: metadata({
      piCustomType: WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE,
      workbenchComposerCommandResponse: response,
    }),
  };
}

export function upsertWorkbenchComposerCommandResponse(
  messages: readonly ThreadMessage[],
  response: WorkbenchComposerCommandResponseDetails,
  timestamp: number,
): ThreadMessage[] {
  const id = workbenchComposerCommandResponseId(response);
  const index = messages.findIndex((message) => message.id === id);
  const next = workbenchComposerCommandResponseThreadMessage(response, timestamp);
  if (index < 0) return [...messages, next];
  const current = messages[index];
  const updated = [...messages];
  updated[index] = current ? { ...next, createdAt: current.createdAt } : next;
  return updated;
}

export function workbenchPromptFailureId(
  failure: Pick<WorkbenchPromptFailureDetails, "submissionId">,
): string {
  return `workbench-prompt-failure:${failure.submissionId}`;
}

export function workbenchPromptFailureThreadMessage(
  failure: WorkbenchPromptFailureDetails,
  timestamp: number,
  id = workbenchPromptFailureId(failure),
): ThreadAssistantMessage {
  const termination: PiMessageTermination = {
    schemaVersion: 1,
    kind: "provider-error",
    stopReason: "error",
    errorMessage: failure.code,
    source: "workbench",
  };
  return {
    id,
    role: "assistant",
    content: [],
    status: { type: "incomplete", reason: "error", error: failure.code },
    createdAt: new Date(timestamp),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {
        piCustomType: WORKBENCH_PROMPT_FAILURE_CUSTOM_TYPE,
        piTermination: termination,
        workbenchTermination: termination,
        workbenchPromptFailure: failure,
        ...(failure.rpcId === undefined ? {} : { workbenchPromptRpcId: failure.rpcId }),
      },
    },
  };
}

export function upsertWorkbenchPromptFailure(
  messages: readonly ThreadMessage[],
  failure: WorkbenchPromptFailureDetails,
  timestamp: number,
  preferredId?: string,
): ThreadMessage[] {
  const stableId = workbenchPromptFailureId(failure);
  const index = messages.findIndex(
    (message) =>
      message.id === stableId ||
      parseWorkbenchPromptFailureDetails(message.metadata.custom.workbenchPromptFailure)
        ?.submissionId === failure.submissionId,
  );
  const current = index < 0 ? undefined : messages[index];
  const next = workbenchPromptFailureThreadMessage(
    failure,
    timestamp,
    current?.id ?? preferredId ?? stableId,
  );
  if (index < 0) return [...messages, next];
  const updated = [...messages];
  updated[index] = current ? { ...next, createdAt: current.createdAt } : next;
  return updated;
}

export function hasRunningWorkbenchCompactCommandResponse(
  messages: readonly ThreadMessage[],
): boolean {
  return messages.some((message) => {
    const response = parseWorkbenchComposerCommandResponseDetails(
      message.metadata.custom.workbenchComposerCommandResponse,
    );
    return response?.commandId === "compact" && response.status === "running";
  });
}

function imageUrl(image: PiImageContent): string {
  if (image.data.startsWith("data:") || /^https?:\/\//i.test(image.data)) return image.data;
  return `data:${image.mimeType};base64,${image.data}`;
}

function threadImagePart(image: PiImageContent): ImageMessagePart {
  return {
    type: "image",
    image: imageUrl(image),
    ...(image.name === undefined ? {} : { filename: image.name }),
  };
}

function threadRecognizableAttachmentPart(attachment: {
  data: string;
  mimeType: string;
  name?: string;
}): ThreadUserMessage["content"][number] {
  if (attachment.mimeType.startsWith("image/")) {
    return threadImagePart({
      type: "image",
      data: attachment.data,
      mimeType: attachment.mimeType,
      ...(attachment.name === undefined ? {} : { name: attachment.name }),
    });
  }
  const data = attachment.data.startsWith("data:")
    ? attachment.data
    : `data:${attachment.mimeType};base64,${attachment.data}`;
  return {
    type: "file",
    data,
    mimeType: attachment.mimeType,
    ...(attachment.name === undefined ? {} : { filename: attachment.name }),
  };
}

export function piUserMessageContent(
  content: PiUserMessage["content"],
): ThreadUserMessage["content"] {
  if (typeof content === "string") {
    return [{ type: "text", text: stripWorkspaceFeedbackContext(content) }];
  }

  return content.map((part) =>
    part.type === "image"
      ? threadImagePart(part)
      : { type: "text", text: stripWorkspaceFeedbackContext(part.text) },
  );
}

function messageContentText(content: string | readonly { type: string; text?: string }[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is { type: "text"; text: string } =>
      Boolean(part.type === "text" && typeof part.text === "string"),
    )
    .map((part) => part.text)
    .join("\n");
}

function toolExecutionOutput(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;

  const candidate = result as { content?: unknown; details?: unknown };
  if (!Array.isArray(candidate.content)) return result;

  const text = messageContentText(candidate.content as readonly { type: string; text?: string }[]);
  return candidate.details === undefined ? text : { text, details: candidate.details };
}

function assistantStatus(message: PiAssistantMessage, streaming: boolean) {
  if (streaming) return { type: "running" } as const;
  switch (message.stopReason) {
    case "aborted":
      return { type: "incomplete", reason: "cancelled" } as const;
    case "length":
      return { type: "incomplete", reason: "length" } as const;
    case "error":
      return {
        type: "incomplete",
        reason: "error",
        error: message.errorMessage ?? "pi_response_error",
      } as const;
    default:
      return { type: "complete", reason: "unknown" } as const;
  }
}

function persistedMessageTiming(
  message: PiAssistantMessage,
  completedAt: number | null | undefined,
  firstTokenAt?: number | null,
): MessageTiming | undefined {
  const streamStartTime = message.timestamp;
  if (
    streamStartTime === undefined ||
    completedAt === undefined ||
    completedAt === null ||
    !Number.isFinite(streamStartTime) ||
    !Number.isFinite(completedAt) ||
    completedAt < streamStartTime
  ) {
    return undefined;
  }

  const totalStreamTime = completedAt - streamStartTime;
  const tokenCount = message.usage?.output;
  const firstTokenTime =
    firstTokenAt !== undefined &&
    firstTokenAt !== null &&
    Number.isFinite(firstTokenAt) &&
    firstTokenAt >= streamStartTime &&
    firstTokenAt <= completedAt
      ? firstTokenAt - streamStartTime
      : undefined;
  return {
    streamStartTime,
    ...(firstTokenTime === undefined ? {} : { firstTokenTime }),
    totalStreamTime,
    ...(tokenCount === undefined ? {} : { tokenCount }),
    ...(tokenCount === undefined || totalStreamTime <= 0
      ? {}
      : { tokensPerSecond: tokenCount / (totalStreamTime / 1_000) }),
    totalChunks: 0,
    toolCallCount: message.content.filter((part) => part.type === "toolCall").length,
  };
}

function reasoningProviderMetadata(timing: MessageTiming | undefined) {
  if (!timing) return undefined;
  const startedAt = Number.isFinite(timing.streamStartTime) ? timing.streamStartTime : undefined;
  const durationMs =
    timing.totalStreamTime !== undefined &&
    Number.isFinite(timing.totalStreamTime) &&
    timing.totalStreamTime >= 0
      ? timing.totalStreamTime
      : undefined;
  if (startedAt === undefined && durationMs === undefined) return undefined;

  return {
    pi: {
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(durationMs === undefined ? {} : { durationMs }),
    },
  };
}

export function piAssistantToThreadMessage(
  message: PiAssistantMessage,
  id: string,
  {
    optimistic = false,
    streaming = false,
    timing,
    toolTimingById,
    rawToolArgsText,
    createdAt,
    eventSeq,
  }: Readonly<{
    optimistic?: boolean;
    streaming?: boolean;
    timing?: MessageTiming;
    toolTimingById?: ReadonlyMap<string, ToolCallTiming>;
    rawToolArgsText?: Readonly<Record<string, string>>;
    createdAt?: number;
    eventSeq?: number;
  }> = {},
): ThreadAssistantMessage {
  const termination = terminationFromAssistantMessage(message);
  const parallelTools = message.content.filter((part) => part.type === "toolCall");
  const parallelToolCount = parallelTools.length;
  const parallelToolBatchId = parallelTools[0]?.id;
  const parallelToolMetadata =
    parallelToolCount > 1 && parallelToolBatchId
      ? {
          providerMetadata: {
            pi: {
              parallelToolBatchId,
              parallelToolBatchSize: parallelToolCount,
            },
          },
        }
      : {};
  let content: ThreadAssistantMessage["content"] = message.content.map((part, contentIndex) => {
    switch (part.type) {
      case "text":
        return {
          type: "text" as const,
          text: part.text,
          status: streaming ? ({ type: "running" } as const) : ({ type: "complete" } as const),
        };
      case "thinking":
        const providerMetadata = reasoningProviderMetadata(timing);
        return {
          type: "reasoning" as const,
          text: part.redacted ? "" : part.thinking,
          status: streaming ? ({ type: "running" } as const) : ({ type: "complete" } as const),
          ...(providerMetadata === undefined ? {} : { providerMetadata }),
        };
      case "image":
        return threadImagePart(part);
      case "toolCall":
        const toolTiming =
          toolTimingById?.get(part.id) ??
          (parallelToolCount !== 1 || message.timestamp === undefined
            ? undefined
            : { startedAt: message.timestamp });
        return {
          type: "tool-call" as const,
          toolCallId: part.id,
          toolName: part.name,
          args: part.arguments as ToolCallMessagePart["args"],
          argsText: rawToolArgsText?.[String(contentIndex)] ?? JSON.stringify(part.arguments),
          ...parallelToolMetadata,
          ...(toolTiming ? { timing: toolTiming } : {}),
        };
    }
  });
  if (streaming && content.length === 0) {
    content = [{ type: "text", text: "", status: { type: "running" } }];
  }
  const usage = message.usage
    ? ({
        input: message.usage.input,
        output: message.usage.output,
        cacheRead: message.usage.cacheRead,
        cacheWrite: message.usage.cacheWrite,
        totalTokens: message.usage.totalTokens,
      } satisfies PiUsageMetadata)
    : undefined;

  return {
    id,
    role: "assistant",
    content,
    status: assistantStatus(message, streaming),
    createdAt: messageDate(message.timestamp ?? createdAt, 0),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      ...(optimistic ? { isOptimistic: true } : {}),
      ...(timing ? { timing } : {}),
      custom: {
        piMessageTimestamp: message.timestamp ?? null,
        ...(eventSeq === undefined ? {} : { piEventSeq: eventSeq }),
        ...(eventSeq === undefined ? {} : { workbenchStateToken: String(eventSeq) }),
        piModel: message.model,
        piProvider: message.provider,
        ...(message.rawStopReason ? { piRawStopReason: message.rawStopReason } : {}),
        ...(message.diagnostics ? { piDiagnostics: message.diagnostics } : {}),
        ...(termination ? { piTermination: termination } : {}),
        ...(termination ? { workbenchTermination: termination } : {}),
        ...(usage ? { piUsage: usage, workbenchUsage: usage } : {}),
      },
    },
  };
}

export type PiToolExecutionUpdate =
  | {
      state: "running";
      toolCallId: string;
      partialResult?: unknown;
      startedAt?: number;
    }
  | {
      state: "complete";
      toolCallId: string;
      result: unknown;
      isError: boolean;
      completedAt?: number;
    };

export function applyToolExecutionUpdate(
  messages: ThreadMessage[],
  update: PiToolExecutionUpdate,
): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message || message.role !== "assistant") continue;
    if (
      !message.content.some(
        (part) => part.type === "tool-call" && part.toolCallId === update.toolCallId,
      )
    ) {
      continue;
    }

    const output = toolExecutionOutput(
      update.state === "running" ? update.partialResult : update.result,
    );
    const content = message.content.map((part) => {
      if (part.type !== "tool-call" || part.toolCallId !== update.toolCallId) return part;

      if (update.state === "running") {
        return {
          ...part,
          artifact: output,
          ...(part.timing || update.startedAt === undefined
            ? {}
            : { timing: { startedAt: update.startedAt } }),
        } satisfies ToolCallMessagePart;
      }

      const startedAt = part.timing?.startedAt;
      const completedAt = part.timing?.completedAt ?? update.completedAt;

      return {
        ...part,
        artifact: undefined,
        result: output,
        isError: update.isError,
        ...(startedAt === undefined
          ? {}
          : {
              timing: {
                startedAt,
                ...(completedAt === undefined ? {} : { completedAt }),
              },
            }),
      } satisfies ToolCallMessagePart;
    });
    const hasRunningTool = content.some(
      (part) => part.type === "tool-call" && part.result === undefined,
    );
    messages[index] = {
      ...message,
      content,
      status:
        update.state === "running" || hasRunningTool
          ? { type: "running" }
          : { type: "complete", reason: "unknown" },
    };
    return true;
  }

  return false;
}

function applyToolResult(messages: ThreadMessage[], result: PiToolResultMessage): void {
  applyToolExecutionUpdate(messages, {
    state: "complete",
    toolCallId: result.toolCallId,
    result,
    isError: result.isError === true,
    completedAt: result.timestamp,
  });
}

function isEmptyStreamingPlaceholder(message: ThreadAssistantMessage): boolean {
  return (
    message.status.type === "running" &&
    message.content.length === 1 &&
    message.content[0]?.type === "text" &&
    message.content[0].text === ""
  );
}

function messageSourceTimestamp(message: ThreadMessage): number | undefined {
  const sourceTimestamp = message.metadata.custom.piMessageTimestamp;
  if (sourceTimestamp === null) return undefined;
  if (typeof sourceTimestamp === "number" && Number.isFinite(sourceTimestamp)) {
    return sourceTimestamp;
  }

  const createdAt = message.createdAt.getTime();
  return Number.isFinite(createdAt) ? createdAt : undefined;
}

function assistantTurnTiming(
  messages: readonly ThreadAssistantMessage[],
  content: ThreadAssistantMessage["content"],
  turnStartedAt?: number,
): { startedAt: number; completedAt: number } | undefined {
  const starts = messages.flatMap((message) => {
    const streamStartedAt = message.metadata.timing?.streamStartTime;
    const sourceTimestamp = messageSourceTimestamp(message);
    return [
      ...(sourceTimestamp === undefined ? [] : [sourceTimestamp]),
      ...(streamStartedAt === undefined || !Number.isFinite(streamStartedAt)
        ? []
        : [streamStartedAt]),
    ];
  });
  if (turnStartedAt !== undefined && Number.isFinite(turnStartedAt)) starts.push(turnStartedAt);

  const completions = messages.flatMap((message) => {
    const timing = message.metadata.timing;
    return timing?.totalStreamTime === undefined
      ? []
      : [timing.streamStartTime + timing.totalStreamTime];
  });
  for (const part of content) {
    if (part.type === "tool-call" && part.timing?.completedAt !== undefined) {
      completions.push(part.timing.completedAt);
    }
  }

  if (starts.length === 0 || completions.length === 0) return undefined;
  const startedAt = Math.min(...starts);
  const completedAt = Math.max(...completions);
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
    return undefined;
  }

  return { startedAt, completedAt };
}

function modelChangeEvent(message: ThreadMessage): PiModelChangeConversationEvent | undefined {
  if (message.role !== "system") return undefined;
  const event = parsePiConversationEvent(message.metadata.custom.piConversationEvent);
  return event?.kind === "model-change" ? event : undefined;
}

function mergeModelChangeEvents(
  first: PiModelChangeConversationEvent,
  last: PiModelChangeConversationEvent,
): PiModelChangeConversationEvent {
  const previousModel = first.previousModel ?? first.model;
  const previousProvider = first.previousModel ? first.previousProvider : first.provider;

  return {
    kind: "model-change",
    model: last.model,
    ...(last.provider ? { provider: last.provider } : {}),
    ...(previousModel ? { previousModel } : {}),
    ...(previousProvider ? { previousProvider } : {}),
  };
}

export function coalesceConsecutiveAssistantMessages(
  messages: readonly ThreadMessage[],
): ThreadMessage[] {
  const coalesced: ThreadMessage[] = [];
  let assistantGroup: ThreadAssistantMessage[] = [];
  let turnStartedAt: number | undefined;

  const appendMessage = (message: ThreadMessage) => {
    const previous = coalesced.at(-1);
    const previousEvent = previous ? modelChangeEvent(previous) : undefined;
    const currentEvent = modelChangeEvent(message);

    if (previous?.role === "system" && message.role === "system" && previousEvent && currentEvent) {
      coalesced[coalesced.length - 1] = {
        ...previous,
        metadata: {
          ...previous.metadata,
          custom: {
            ...previous.metadata.custom,
            ...message.metadata.custom,
            piConversationEvent: mergeModelChangeEvents(previousEvent, currentEvent),
            workbenchConversationEvent: projectPiConversationEvent(
              mergeModelChangeEvents(previousEvent, currentEvent),
            ),
          },
        },
      };
      return;
    }

    coalesced.push(message);
  };

  const flushAssistantGroup = () => {
    const first = assistantGroup[0];
    if (!first) return;

    const content: ThreadAssistantMessage["content"][number][] = [];
    const appendContent = (parts: ThreadAssistantMessage["content"]) => {
      for (const part of parts) {
        if (part.type === "data" && isRecognitionDataName(part.name)) {
          const previousIndex = content.findIndex(
            (candidate) => candidate.type === "data" && isRecognitionDataName(candidate.name),
          );
          if (previousIndex >= 0) {
            // Attachment recognition is one aggregate state machine per assistant turn.
            // Retries can leave several consecutive recognition-only assistant
            // fragments in history; retain the newest snapshot instead of exposing
            // every fragment as a duplicate timeline step.
            content[previousIndex] = part;
            continue;
          }
        }
        content.push(part);
      }
    };

    appendContent(first.content);
    let merged = first;
    for (let index = 1; index < assistantGroup.length; index += 1) {
      const next = assistantGroup[index];
      if (!next) continue;
      if (!isEmptyStreamingPlaceholder(next)) appendContent(next.content);
      merged = {
        ...merged,
        status: next.status,
        metadata: {
          ...merged.metadata,
          ...next.metadata,
          custom: {
            ...merged.metadata.custom,
            ...next.metadata.custom,
          },
        },
      };
    }
    const turnTiming = assistantTurnTiming(assistantGroup, content, turnStartedAt);
    const turnStatistics = aggregatePiTurnStatistics(assistantGroup);
    appendMessage({
      ...merged,
      id: first.id,
      content,
      metadata: {
        ...merged.metadata,
        custom: {
          ...merged.metadata.custom,
          ...(turnTiming ? { piTurnTiming: turnTiming } : {}),
          ...(turnTiming ? { workbenchTurnTiming: turnTiming } : {}),
          piTurnStatistics: turnStatistics,
          workbenchTurnStatistics: turnStatistics,
        },
      },
    });
    assistantGroup = [];
    turnStartedAt = undefined;
  };

  for (const message of messages) {
    if (message.role === "assistant") {
      assistantGroup.push(message);
      continue;
    }
    flushAssistantGroup();
    if (message.role === "user") turnStartedAt = messageSourceTimestamp(message);
    appendMessage(message);
  }
  flushAssistantGroup();

  return coalesced;
}

export function piHistoryToThreadMessages(
  history: PiSessionHistory,
  timingByTimestamp?: ReadonlyMap<number, MessageTiming>,
  toolTimingById?: ReadonlyMap<string, ToolCallTiming>,
  contextTracePromptParts: readonly SessionContextTracePromptPart[] = [],
): ThreadMessage[] {
  const messages: ThreadMessage[] = [];
  const entryIdCounts = new Map<string, number>();
  const composerUserIndexes = new Map<string, number>();
  // A queued Composer marker is persisted before the preceding assistant turn finishes.
  // Once its real user event arrives, keep the marker identity but render it at that event.
  const supersededComposerUserIndexes = new Set<number>();
  const composerCommandResponseIndexes = new Map<string, number>();
  const attachmentRecognitionBySubmissionId = new Map<string, AttachmentRecognitionSnapshot>();
  const runningCompactCommandResponses = new Set<string>();
  const resolvedToolTimingById = new Map<string, ToolCallTiming>();
  for (const timing of history.context.toolTimings ?? []) {
    if (
      Number.isFinite(timing.startedAt) &&
      Number.isFinite(timing.completedAt) &&
      timing.completedAt >= timing.startedAt
    ) {
      resolvedToolTimingById.set(timing.toolCallId, {
        startedAt: timing.startedAt,
        completedAt: timing.completedAt,
      });
    }
  }
  for (const [toolCallId, timing] of toolTimingById ?? []) {
    resolvedToolTimingById.set(toolCallId, timing);
  }

  history.context.messages.forEach((message, index) => {
    const entryId = history.context.entryIds[index] ?? `message-${index}`;
    const previousMatches = entryIdCounts.get(entryId) ?? 0;
    entryIdCounts.set(entryId, previousMatches + 1);
    const id = previousMatches ? `${entryId}-${previousMatches}` : entryId;
    switch (message.role) {
      case "user": {
        const content = piUserMessageContent(message.content);
        const projection = message.workbenchComposer;
        const projectedIndex = projection
          ? composerUserIndexes.get(projection.submissionId)
          : undefined;
        if (projection && projectedIndex !== undefined) {
          const projected = messages[projectedIndex];
          if (projected?.role === "user") {
            const projectedImageUrls = new Set(
              projected.content.flatMap((part) => (part.type === "image" ? [part.image] : [])),
            );
            const resolved = {
              ...projected,
              content: [
                ...projected.content,
                ...content.filter(
                  (part) => part.type === "image" && !projectedImageUrls.has(part.image),
                ),
              ],
              createdAt: messageDate(
                message.timestamp ?? history.context.entryCompletedAts?.[index] ?? undefined,
                index,
              ),
              metadata: {
                ...projected.metadata,
                custom: {
                  ...projected.metadata.custom,
                  piResolvedEntryId: history.context.entryIds[index],
                  piResolvedMessageTimestamp: message.timestamp ?? null,
                  workbenchComposerProjectionResolved: true,
                  ...(attachmentRecognitionBySubmissionId.get(projection.submissionId) === undefined
                    ? {}
                    : {
                        workbenchAttachmentRecognition: attachmentRecognitionBySubmissionId.get(
                          projection.submissionId,
                        ),
                      }),
                  ...(history.context.entrySeqs?.[index] == null
                    ? {}
                    : { piEventSeq: history.context.entrySeqs[index] }),
                },
              },
            };
            supersededComposerUserIndexes.add(projectedIndex);
            composerUserIndexes.set(projection.submissionId, messages.length);
            messages.push(resolved);
            break;
          }
        }
        const visibleContent = projection
          ? [
              { type: "text" as const, text: projection.sourceText },
              ...content.filter((part) => part.type === "image"),
            ]
          : content;
        const threadMessage: ThreadUserMessage = {
          id,
          role: "user",
          content: visibleContent,
          attachments: [],
          createdAt: messageDate(
            message.timestamp ?? history.context.entryCompletedAts?.[index] ?? undefined,
            index,
          ),
          metadata: metadata({
            piEntryId: history.context.entryIds[index],
            piMessageTimestamp: message.timestamp ?? null,
            ...(history.context.entrySeqs?.[index] == null
              ? {}
              : { piEventSeq: history.context.entrySeqs[index] }),
            ...(projection?.document === undefined
              ? {}
              : { workbenchComposerDocument: projection.document }),
            ...(projection === undefined
              ? {}
              : {
                  workbenchComposerSubmissionId: projection.submissionId,
                  workbenchComposerProjectionResolved: true,
                  ...(attachmentRecognitionBySubmissionId.get(projection.submissionId) === undefined
                    ? {}
                    : {
                        workbenchAttachmentRecognition: attachmentRecognitionBySubmissionId.get(
                          projection.submissionId,
                        ),
                      }),
                }),
          }),
        };
        messages.push(threadMessage);
        break;
      }
      case "assistant":
        messages.push(
          piAssistantToThreadMessage(message, id, {
            timing:
              message.timestamp === undefined
                ? undefined
                : (timingByTimestamp?.get(message.timestamp) ??
                  persistedMessageTiming(
                    message,
                    history.context.entryCompletedAts?.[index],
                    history.context.entryFirstTokenAts?.[index],
                  )),
            toolTimingById: resolvedToolTimingById,
            createdAt: history.context.entryCompletedAts?.[index] ?? undefined,
            eventSeq: history.context.entrySeqs?.[index] ?? undefined,
          }),
        );
        break;
      case "toolResult":
        applyToolResult(messages, message);
        break;
      case "custom":
        if (isWorkbenchComposerUserCustomType(message.customType)) {
          const details = parseWorkbenchComposerUserDetails(message.details);
          if (details) {
            const messageIndex = messages.length;
            const displayAttachments = (details.attachments ?? details.images ?? []).map(
              threadRecognizableAttachmentPart,
            );
            const projectedMessage: ThreadUserMessage = {
              id,
              role: "user",
              content: [{ type: "text", text: details.sourceText }, ...displayAttachments],
              attachments: [],
              createdAt: messageDate(
                message.timestamp ?? history.context.entryCompletedAts?.[index] ?? undefined,
                index,
              ),
              metadata: metadata({
                piEntryId: history.context.entryIds[index],
                piMessageTimestamp: message.timestamp ?? null,
                workbenchComposerSubmissionId: details.submissionId,
                ...(details.document === undefined
                  ? {}
                  : { workbenchComposerDocument: details.document }),
                ...(details.commands === undefined
                  ? {}
                  : { workbenchComposerCommands: details.commands }),
                ...(details.composer === undefined
                  ? {}
                  : { workbenchComposerSubmission: details.composer }),
                ...(details.status === undefined
                  ? {}
                  : { workbenchComposerStatus: details.status }),
                ...(attachmentRecognitionBySubmissionId.get(details.submissionId) === undefined
                  ? {}
                  : {
                      workbenchAttachmentRecognition: attachmentRecognitionBySubmissionId.get(
                        details.submissionId,
                      ),
                    }),
              }),
            };
            messages.push(projectedMessage);
            composerUserIndexes.set(details.submissionId, messageIndex);
          }
        } else if (
          message.customType === WORKBENCH_ATTACHMENT_RECOGNITION_CUSTOM_TYPE ||
          message.customType === WORKBENCH_IMAGE_RECOGNITION_CUSTOM_TYPE
        ) {
          const incoming = parseAttachmentRecognitionSnapshot(message.details);
          if (incoming) {
            const current = attachmentRecognitionBySubmissionId.get(incoming.submissionId);
            let next = incoming;
            if (current) {
              try {
                next = reduceAttachmentRecognitionSnapshot(current, incoming);
              } catch {
                break;
              }
            }
            attachmentRecognitionBySubmissionId.set(incoming.submissionId, next);
            const messageIndex = composerUserIndexes.get(incoming.submissionId);
            const projected = messageIndex === undefined ? undefined : messages[messageIndex];
            if (messageIndex !== undefined && projected?.role === "user") {
              messages[messageIndex] = {
                ...projected,
                content: projected.content.filter(
                  (part) => part.type !== "data" || !isRecognitionDataName(part.name),
                ),
                metadata: {
                  ...projected.metadata,
                  custom: {
                    ...projected.metadata.custom,
                    workbenchAttachmentRecognition: next,
                  },
                },
              };
            }
          }
        } else if (isWorkbenchComposerResolutionCustomType(message.customType)) {
          const details = parseWorkbenchComposerResolutionDetails(message.details);
          const messageIndex = details ? composerUserIndexes.get(details.submissionId) : undefined;
          if (details && messageIndex !== undefined) {
            const projected = messages[messageIndex];
            if (projected?.role === "user") {
              messages[messageIndex] = {
                ...projected,
                metadata: {
                  ...projected.metadata,
                  custom: {
                    ...projected.metadata.custom,
                    workbenchComposerStatus: details.status,
                    workbenchComposerCommandTrace: details.commandTrace,
                  },
                },
              };
            }
          }
        } else if (isWorkbenchComposerCommandResponseCustomType(message.customType)) {
          const details = parseWorkbenchComposerCommandResponseDetails(message.details);
          if (details) {
            const responseId = workbenchComposerCommandResponseId(details);
            const responseIndex = composerCommandResponseIndexes.get(responseId);
            if (details.commandId === "compact") {
              if (details.status === "running") runningCompactCommandResponses.add(responseId);
              else runningCompactCommandResponses.delete(responseId);
            }
            if (responseIndex !== undefined) {
              const current = messages[responseIndex];
              messages[responseIndex] = {
                ...workbenchComposerCommandResponseThreadMessage(
                  details,
                  message.timestamp ??
                    history.context.entryCompletedAts?.[index] ??
                    current?.createdAt.getTime() ??
                    index,
                ),
                ...(current ? { createdAt: current.createdAt } : {}),
              };
              break;
            }
            const previous = messages.at(-1);
            const previousConversationEvent =
              previous?.role === "system"
                ? parsePiConversationEvent(previous.metadata.custom.piConversationEvent)
                : undefined;
            const isMatchingCompactionEvent =
              details.commandId === "compact" &&
              details.status === "success" &&
              previousConversationEvent?.kind === "compaction";
            if (isMatchingCompactionEvent && previous?.role === "system") {
              messages[messages.length - 1] = {
                ...previous,
                metadata: {
                  ...previous.metadata,
                  custom: {
                    ...previous.metadata.custom,
                    workbenchComposerCommandResponse: details,
                  },
                },
              };
              composerCommandResponseIndexes.set(responseId, messages.length - 1);
            } else {
              messages.push(
                workbenchComposerCommandResponseThreadMessage(
                  details,
                  message.timestamp ?? history.context.entryCompletedAts?.[index] ?? index,
                ),
              );
              composerCommandResponseIndexes.set(responseId, messages.length - 1);
            }
          }
        } else if (message.customType === WORKBENCH_PROMPT_FAILURE_CUSTOM_TYPE) {
          const details = parseWorkbenchPromptFailureDetails(message.details);
          if (details) {
            messages.push(
              workbenchPromptFailureThreadMessage(
                details,
                message.timestamp ?? history.context.entryCompletedAts?.[index] ?? index,
                id,
              ),
            );
          }
        } else if (message.display) {
          const conversationEvent =
            message.customType === PI_CONVERSATION_EVENT_CUSTOM_TYPE
              ? parsePiConversationEvent(message.details)
              : undefined;
          if (conversationEvent?.kind === "compaction" && runningCompactCommandResponses.size > 0) {
            break;
          }
          messages.push({
            id,
            role: "system",
            content: [{ type: "text", text: messageContentText(message.content) }],
            createdAt: messageDate(
              message.timestamp ?? history.context.entryCompletedAts?.[index] ?? undefined,
              index,
            ),
            metadata: metadata({
              piCustomType: message.customType,
              ...(conversationEvent ? { piConversationEvent: conversationEvent } : {}),
              ...(conversationEvent
                ? { workbenchConversationEvent: projectPiConversationEvent(conversationEvent) }
                : {}),
            }),
          });
        }
        break;
      case "bashExecution":
        messages.push({
          id,
          role: "system",
          content: [
            {
              type: "text",
              text: `$ ${message.command}\n${message.output}`.trimEnd(),
            },
          ],
          createdAt: messageDate(
            message.timestamp ?? history.context.entryCompletedAts?.[index] ?? undefined,
            index,
          ),
          metadata: metadata({ piBashExecution: true }),
        });
        break;
    }
  });

  let chronologicallyProjectedMessages = supersededComposerUserIndexes.size
    ? messages.filter((_message, index) => !supersededComposerUserIndexes.has(index))
    : messages;
  for (const snapshot of attachmentRecognitionBySubmissionId.values()) {
    chronologicallyProjectedMessages = reconcileAttachmentRecognitionInMessages(
      chronologicallyProjectedMessages,
      snapshot,
    );
  }
  return coalesceConsecutiveAssistantMessages(
    projectPiContextTracePromptParts(chronologicallyProjectedMessages, contextTracePromptParts),
  );
}

export function sameUserPrompt(left: ThreadUserMessage, right: ThreadUserMessage): boolean {
  const leftPrompt = appendMessageToPiPrompt(left);
  const rightPrompt = appendMessageToPiPrompt(right);
  if (
    stripWorkspaceFeedbackContext(leftPrompt.text) !==
      stripWorkspaceFeedbackContext(rightPrompt.text) ||
    leftPrompt.images.length !== rightPrompt.images.length ||
    leftPrompt.documents.length !== rightPrompt.documents.length
  ) {
    return false;
  }
  return (
    leftPrompt.images.every(
      (image, index) =>
        image.mimeType === rightPrompt.images[index]?.mimeType &&
        image.data === rightPrompt.images[index]?.data,
    ) &&
    leftPrompt.documents.every(
      (document, index) =>
        document.mimeType === rightPrompt.documents[index]?.mimeType &&
        document.data === rightPrompt.documents[index]?.data,
    )
  );
}

export function reconcileLiveMessagesAfterHistory(
  liveMessages: readonly ThreadMessage[],
  authoritativeMessages: readonly ThreadMessage[],
  options: Readonly<{
    liveMessageIdsAtStart: ReadonlySet<string>;
    baseMessageIdsAtStart: ReadonlySet<string>;
    preserveUnpersistedOptimisticUsers: boolean;
  }>,
): ThreadMessage[] {
  const newAuthoritativeUsers = authoritativeMessages.filter(
    (message): message is ThreadUserMessage =>
      message.role === "user" && !options.baseMessageIdsAtStart.has(message.id),
  );
  const authoritativeEventSequences = new Set(
    authoritativeMessages.flatMap((message) => {
      const sequence = message.metadata.custom.piEventSeq;
      return typeof sequence === "number" && Number.isFinite(sequence) ? [sequence] : [];
    }),
  );

  return liveMessages.filter((message) => {
    const eventSequence = message.metadata.custom.piEventSeq;
    if (
      typeof eventSequence === "number" &&
      Number.isFinite(eventSequence) &&
      authoritativeEventSequences.has(eventSequence)
    ) {
      return false;
    }
    if (!options.liveMessageIdsAtStart.has(message.id)) return true;
    if (
      !options.preserveUnpersistedOptimisticUsers ||
      message.role !== "user" ||
      message.metadata.custom.piOptimistic !== true
    ) {
      return false;
    }

    const replacementIndex = newAuthoritativeUsers.findIndex((candidate) =>
      sameUserPrompt(message, candidate),
    );
    if (replacementIndex < 0) return true;
    newAuthoritativeUsers.splice(replacementIndex, 1);
    return false;
  });
}

function splitDataUrl(value: string, fallbackMimeType: string, name?: string): PiImageContent {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(value);
  return {
    type: "image",
    mimeType: match?.[1] ?? fallbackMimeType,
    data: match?.[2] ?? value,
    ...(name === undefined ? {} : { name }),
  };
}

function splitDocumentDataUrl(
  value: string,
  fallbackMimeType: "application/pdf",
  name?: string,
): PiDocumentContent {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(value);
  return {
    type: "file",
    mimeType: (match?.[1] ?? fallbackMimeType) as "application/pdf",
    data: match?.[2] ?? value,
    ...(name === undefined ? {} : { name }),
  };
}

export function appendMessageToPiPrompt(
  message: Pick<AppendMessage, "content" | "attachments"> &
    Partial<Pick<AppendMessage, "runConfig">>,
): {
  text: string;
  images: PiImageContent[];
  documents: PiDocumentContent[];
  composer?: WorkbenchComposerSubmission;
} {
  const sourceText = message.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const composer = workbenchComposerSubmissionFromRunConfig(message.runConfig);
  const text = composer?.text ?? sourceText;
  const images: PiImageContent[] = [];
  const documents: PiDocumentContent[] = [];

  const collect = (part: (typeof message.content)[number], fallbackName?: string) => {
    if (part.type === "image") {
      images.push(splitDataUrl(part.image, "image/png", part.filename ?? fallbackName));
    } else if (part.type === "file" && part.mimeType.startsWith("image/")) {
      images.push(splitDataUrl(part.data, part.mimeType, part.filename ?? fallbackName));
    } else if (part.type === "file" && part.mimeType === "application/pdf") {
      documents.push(
        splitDocumentDataUrl(part.data, "application/pdf", part.filename ?? fallbackName),
      );
    }
  };
  message.content.forEach((part) => collect(part));
  message.attachments?.forEach((attachment) =>
    attachment.content.forEach((part) => collect(part, attachment.name)),
  );

  return { text, images, documents, ...(composer === undefined ? {} : { composer }) };
}

export function optimisticUserMessage(
  message: AppendMessage,
  id: string,
  promptRpcId?: string,
): ThreadMessage {
  const content: ThreadUserMessage["content"] = message.content.filter(
    (part): part is ThreadUserMessage["content"][number] =>
      part.type === "text" ||
      part.type === "image" ||
      part.type === "file" ||
      part.type === "data" ||
      part.type === "audio",
  );
  const attachmentParts: ThreadUserMessage["content"] = (message.attachments ?? []).flatMap(
    (attachment) =>
      attachment.content.flatMap((part) =>
        part.type === "image" || part.type === "file"
          ? [
              {
                ...part,
                filename: part.filename ?? attachment.name,
              },
            ]
          : [],
      ),
  );
  const sentContent = [...content, ...attachmentParts];
  const composer = workbenchComposerSubmissionFromRunConfig(message.runConfig);
  const visibleContent: ThreadUserMessage["content"] = composer
    ? [
        { type: "text", text: composer.sourceText },
        ...sentContent.filter((part) => part.type === "image" || part.type === "file"),
      ]
    : sentContent;
  return {
    id,
    role: "user",
    content: visibleContent,
    // Sent attachments are canonical message parts. Keeping both projections would render
    // twice and make the optimistic layout differ from the persisted Pi history.
    attachments: [],
    createdAt: message.createdAt,
    metadata: {
      ...metadata({
        piOptimistic: true,
        ...(promptRpcId === undefined ? {} : { workbenchPromptRpcId: promptRpcId }),
        ...(composer?.document === undefined
          ? {}
          : { workbenchComposerDocument: composer.document }),
      }),
      isOptimistic: true,
    },
  };
}

export function eventMessage(event: Record<string, unknown>): PiAgentMessage | undefined {
  const message = event.message;
  if (!message || typeof message !== "object" || !("role" in message)) return undefined;
  return message as PiAgentMessage;
}
