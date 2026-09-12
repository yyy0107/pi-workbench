import type {
  PiAgentMessage,
  PiAssistantMessage,
  PiConversationEvent,
  PiImageContent,
  PiRunTiming,
  PiSessionHistory,
  PiSessionSummary,
  PiWorkspaceSummary,
} from "@workbench/agent-runtime-pi-protocol/messages";
import { isInlineImageMediaType } from "@workbench/agent-runtime-pi-protocol/attachments";
import { parseAutomationSessionOrigin } from "@workbench/automation-contracts";
import { parseWorkbenchComposerUserProjection } from "@workbench/contracts/composer/request";
import { deriveSessionDisplayTitle } from "@workbench/agent-runtime-pi-shared/sessions";
import type {
  SessionHistoryValue,
  SessionListItem,
  SessionPromptContent,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import { isSessionMessageChunkData } from "@workbench/agent-runtime-pi-protocol/stream";
import {
  conversationEventFromSessionEvent,
  modelChangeConversationEvent,
  piConversationEventMessage,
} from "../messages/conversation-events";
import { SessionMessageAccumulator } from "../transport/session-message-accumulator";
import {
  appendWorkspaceFeedbackContext,
  type PromptFeedbackItem,
} from "@workbench/agent-runtime-client/prompt-feedback";

export const WORKBENCH_SESSION_SUMMARY_PROJECTION = "workbench.piSessionSummary";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function projectedRunTiming(value: unknown): PiRunTiming | undefined {
  const candidate = record(value);
  const startedAt = numberValue(candidate?.startedAt);
  const elapsedMs = numberValue(candidate?.elapsedMs);
  if (
    startedAt === undefined ||
    !Number.isInteger(startedAt) ||
    startedAt < 0 ||
    elapsedMs === undefined ||
    !Number.isInteger(elapsedMs) ||
    elapsedMs < 0
  ) {
    return undefined;
  }
  return { startedAt, elapsedMs };
}

function projectedWorkspace(value: unknown, cwd: string): PiWorkspaceSummary {
  const candidate = record(value);
  const projectedCwd = stringValue(candidate?.cwd) ?? cwd;
  return {
    id: stringValue(candidate?.id) ?? "",
    name:
      stringValue(candidate?.name) ??
      projectedCwd.split(/[\\/]/).filter(Boolean).at(-1) ??
      projectedCwd,
    cwd: projectedCwd,
  };
}

/** Adapt the protocol list row while keeping Workbench-only display metadata in projections. */
export function piSummaryFromSessionListItem(item: SessionListItem): PiSessionSummary {
  const projected = record(item.projections?.values[WORKBENCH_SESSION_SUMMARY_PROJECTION]);
  const cwd = item.cwd ?? stringValue(projected?.cwd) ?? "";
  const updatedAt = new Date(item.updatedAt).toISOString();
  const created = stringValue(projected?.created) ?? updatedAt;
  const messageCount = numberValue(projected?.messageCount) ?? (item.blank ? 0 : 1);
  const runTiming = item.runTiming ?? projectedRunTiming(projected?.runTiming);
  const automationOrigin = parseAutomationSessionOrigin(projected?.automationOrigin);
  const name = deriveSessionDisplayTitle(stringValue(projected?.name));

  return {
    id: item.sessionId,
    cwd,
    workspace: projectedWorkspace(projected?.workspace, cwd),
    ...(name ? { name } : {}),
    created,
    modified: updatedAt,
    messageCount,
    firstMessage: deriveSessionDisplayTitle(stringValue(projected?.firstMessage)),
    transient: booleanValue(projected?.transient) ?? false,
    running: item.running,
    waitingForUserInput:
      item.waitingForUserInput ?? booleanValue(projected?.waitingForUserInput) ?? false,
    ...(item.running && runTiming !== undefined ? { runTiming } : {}),
    ...(automationOrigin === undefined ? {} : { automationOrigin }),
  };
}

function piMessage(value: unknown): PiAgentMessage | undefined {
  const candidate = record(value);
  const role = candidate?.role;
  if (
    role !== "user" &&
    role !== "assistant" &&
    role !== "toolResult" &&
    role !== "custom" &&
    role !== "bashExecution"
  ) {
    return undefined;
  }
  return candidate as unknown as PiAgentMessage;
}

function assistantMessageHasOutput(message: PiAgentMessage | undefined): boolean {
  return (
    message?.role === "assistant" &&
    message.content.some(
      (part) =>
        (part.type === "text" && part.text.length > 0) ||
        (part.type === "thinking" && !part.redacted && part.thinking.length > 0),
    )
  );
}

/** Rebuild canonical Pi message history from persisted session events. */
export function piHistoryFromSessionEvents(
  sessionId: string,
  history: SessionHistoryValue,
): PiSessionHistory {
  const messages: PiAgentMessage[] = [];
  const entryIds: string[] = [];
  const entrySeqs: Array<number | null> = [];
  const entryCompletedAts: Array<number | null> = [];
  const entryFirstTokenAts: Array<number | null> = [];
  const toolStarts = new Map<string, number>();
  const toolTimings: NonNullable<PiSessionHistory["context"]["toolTimings"]> = [];
  let currentModel: Pick<PiAssistantMessage, "model" | "provider"> | undefined;
  let assistantMessageActive = false;
  let assistantMessageStartedAt: number | undefined;
  let firstAssistantTokenAt: number | undefined;
  let assistantAccumulator: SessionMessageAccumulator | undefined;
  let activeAssistant: PiSessionHistory["context"]["activeAssistant"];
  let steeringQueue: string[] = [];
  let removedSteering: string[] = [];
  let userIsSteering = false;

  const discardRetryingAssistant = () => {
    const userIndex = messages.findLastIndex((message) => message.role === "user");
    const assistantIndex = messages.findLastIndex(
      (message) => message.role === "assistant" && message.stopReason === "error",
    );
    if (assistantIndex < 0 || assistantIndex < userIndex) return;
    messages.splice(assistantIndex, 1);
    entryIds.splice(assistantIndex, 1);
    entrySeqs.splice(assistantIndex, 1);
    entryCompletedAts.splice(assistantIndex, 1);
    entryFirstTokenAts.splice(assistantIndex, 1);
  };

  const pushMessage = (
    message: PiAgentMessage,
    entryId: string,
    completedAt: number,
    firstTokenAt?: number,
    eventSeq?: number,
  ) => {
    messages.push(message);
    entryIds.push(entryId);
    entrySeqs.push(eventSeq ?? null);
    entryCompletedAts.push(completedAt);
    entryFirstTokenAts.push(firstTokenAt ?? null);
  };

  const finalizeInterruptedAssistant = () => {
    if (activeAssistant?.message.content.length) {
      pushMessage(
        { ...activeAssistant.message, stopReason: "aborted" },
        activeAssistant.entryId,
        activeAssistant.updatedAt,
        activeAssistant.firstTokenAt,
        activeAssistant.lastSeq,
      );
    }
    assistantAccumulator = undefined;
    activeAssistant = undefined;
    assistantMessageActive = false;
    assistantMessageStartedAt = undefined;
    firstAssistantTokenAt = undefined;
  };

  const pushConversationEvent = (
    event: PiConversationEvent,
    entryId: string,
    timestamp: number,
    eventSeq?: number,
  ) => {
    pushMessage(
      piConversationEventMessage(event, timestamp),
      entryId,
      timestamp,
      undefined,
      eventSeq,
    );
  };

  const insertConversationEventBeforeLastMessage = (
    event: PiConversationEvent,
    entryId: string,
    fallbackTimestamp: number,
    eventSeq?: number,
  ) => {
    const index = messages.length - 1;
    if (messages[index]?.role !== "user") {
      pushConversationEvent(event, entryId, fallbackTimestamp, eventSeq);
      return;
    }
    const timestamp = entryCompletedAts[index] ?? fallbackTimestamp;
    messages.splice(index, 0, piConversationEventMessage(event, timestamp));
    entryIds.splice(index, 0, entryId);
    entrySeqs.splice(index, 0, eventSeq ?? null);
    entryCompletedAts.splice(index, 0, timestamp);
    entryFirstTokenAts.splice(index, 0, null);
  };

  for (const { event } of history.events) {
    const eventId = event.entryId ?? `pi-event-${event.seq}`;
    const data = record(event.data);
    if (event.type === "queue_update") {
      const nextQueue = Array.isArray(data?.steering)
        ? data.steering.filter((value): value is string => typeof value === "string")
        : [];
      const remaining = [...nextQueue];
      // ponytail: queues are small; use counted maps if large queues make this scan costly.
      removedSteering = steeringQueue.filter((prompt) => {
        const index = remaining.indexOf(prompt);
        if (index < 0) return true;
        remaining.splice(index, 1);
        return false;
      });
      steeringQueue = nextQueue;
      continue;
    }
    if (event.type === "message_start") {
      const message = piMessage(data?.message);
      const text =
        message?.role === "user"
          ? typeof message.content === "string"
            ? message.content
            : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
          : undefined;
      // Pi emits the queue removal immediately before delivering the matching user message.
      // Explicit removals followed by another event must not mark a later ordinary prompt.
      userIsSteering = text !== undefined && removedSteering.includes(text);
    }
    removedSteering = [];
    if (event.type === "auto_retry_start") {
      discardRetryingAssistant();
      continue;
    }
    if (event.type === "tool_execution_start" && typeof data?.toolCallId === "string") {
      toolStarts.set(data.toolCallId, event.time);
    } else if (event.type === "tool_execution_end" && typeof data?.toolCallId === "string") {
      const startedAt = toolStarts.get(data.toolCallId);
      if (startedAt !== undefined && event.time >= startedAt) {
        toolTimings.push({ toolCallId: data.toolCallId, startedAt, completedAt: event.time });
      }
    }

    if (event.type === "message_start") {
      const startedMessage = piMessage(data?.message);
      if (activeAssistant) finalizeInterruptedAssistant();
      assistantMessageActive = startedMessage?.role === "assistant";
      assistantMessageStartedAt = assistantMessageActive ? event.time : undefined;
      firstAssistantTokenAt = undefined;
      if (startedMessage?.role === "assistant") {
        assistantAccumulator = new SessionMessageAccumulator();
        assistantAccumulator.start(startedMessage, event.seq, event.time);
        activeAssistant = {
          message: startedMessage,
          entryId: eventId,
          startSeq: event.seq,
          lastSeq: event.seq,
          updatedAt: event.time,
        };
      }
    } else if (
      event.type === "message_update" &&
      assistantMessageActive &&
      isSessionMessageChunkData(event.data)
    ) {
      const result = assistantAccumulator?.applyChunk(event.data, event.seq, event.time);
      if (result?.kind === "event") {
        const updatedMessage = piMessage(result.event.message);
        if (updatedMessage?.role === "assistant" && activeAssistant) {
          if (
            firstAssistantTokenAt === undefined &&
            (event.data.updates.some(
              (update) =>
                (update.type === "text_delta" || update.type === "thinking_delta") &&
                update.delta.length > 0,
            ) ||
              assistantMessageHasOutput(updatedMessage))
          ) {
            firstAssistantTokenAt = event.time;
          }
          activeAssistant = {
            ...activeAssistant,
            message: updatedMessage,
            lastSeq: event.seq,
            updatedAt: event.time,
            ...(firstAssistantTokenAt === undefined ? {} : { firstTokenAt: firstAssistantTokenAt }),
            ...(result.event.rawToolArgsText === undefined
              ? {}
              : { rawToolArgsText: result.event.rawToolArgsText }),
          };
        }
      }
    } else if (event.type === "message_update" && assistantMessageActive) {
      // Canonical journals written before durable chunks stored Pi's cumulative update event.
      const updatedMessage = piMessage(data?.message);
      const update = record(data?.assistantMessageEvent);
      const updateType = stringValue(update?.type);
      const hasTextDelta =
        (updateType === "text_delta" || updateType === "thinking_delta") &&
        typeof update?.delta === "string" &&
        update.delta.length > 0;
      if (
        firstAssistantTokenAt === undefined &&
        (hasTextDelta || assistantMessageHasOutput(updatedMessage))
      ) {
        firstAssistantTokenAt = event.time;
      }
      if (updatedMessage?.role === "assistant" && activeAssistant) {
        activeAssistant = {
          ...activeAssistant,
          message: updatedMessage,
          lastSeq: event.seq,
          updatedAt: event.time,
          ...(firstAssistantTokenAt === undefined ? {} : { firstTokenAt: firstAssistantTokenAt }),
        };
      }
    }

    const conversationEvent = conversationEventFromSessionEvent(event.type, event.data);
    if (conversationEvent) {
      pushConversationEvent(
        conversationEvent,
        `${eventId}:conversation-event`,
        event.time,
        event.seq,
      );
      if (conversationEvent.kind === "model-change") {
        currentModel = {
          model: conversationEvent.model,
          provider: conversationEvent.provider,
        };
      }
      continue;
    }

    const message =
      event.type === "message"
        ? piMessage(event.data)
        : event.type === "message_end"
          ? piMessage(data?.message)
          : undefined;
    if (!message) continue;

    const composerProjection =
      message.role === "user"
        ? parseWorkbenchComposerUserProjection(data?.workbenchComposer)
        : undefined;
    let projectedMessage =
      message.role === "user" && composerProjection
        ? { ...message, workbenchComposer: composerProjection }
        : message;
    if (projectedMessage.role === "user" && userIsSteering) {
      projectedMessage = { ...projectedMessage, workbenchSteering: true };
      userIsSteering = false;
    }

    if (projectedMessage.role === "assistant" && projectedMessage.model) {
      const derivedModelChange = currentModel
        ? modelChangeConversationEvent(
            projectedMessage.model,
            projectedMessage.provider,
            currentModel.model,
            currentModel.provider,
          )
        : undefined;
      if (derivedModelChange) {
        insertConversationEventBeforeLastMessage(
          derivedModelChange,
          `${eventId}:derived-model-change`,
          event.time,
          event.seq,
        );
      }
      currentModel = { model: projectedMessage.model, provider: projectedMessage.provider };
    }

    const persistedFirstTokenAt = numberValue(record(data?.workbenchTiming)?.firstTokenAt);
    const validPersistedFirstTokenAt =
      event.type === "message_end" &&
      projectedMessage.role === "assistant" &&
      assistantMessageStartedAt !== undefined &&
      persistedFirstTokenAt !== undefined &&
      persistedFirstTokenAt >= assistantMessageStartedAt &&
      persistedFirstTokenAt <= event.time
        ? persistedFirstTokenAt
        : undefined;
    const completedFirstTokenAt =
      event.type === "message_end" && projectedMessage.role === "assistant"
        ? (validPersistedFirstTokenAt ??
          firstAssistantTokenAt ??
          (assistantMessageStartedAt !== undefined && assistantMessageHasOutput(projectedMessage)
            ? event.time
            : undefined))
        : undefined;

    pushMessage(
      projectedMessage,
      eventId,
      event.time,
      completedFirstTokenAt,
      event.type === "message_end" ? event.seq : undefined,
    );
    if (projectedMessage.role === "assistant") {
      assistantAccumulator = undefined;
      activeAssistant = undefined;
      assistantMessageActive = false;
      assistantMessageStartedAt = undefined;
      firstAssistantTokenAt = undefined;
    }
  }

  return {
    sessionId,
    context: {
      messages,
      entryIds,
      entrySeqs,
      entryCompletedAts,
      entryFirstTokenAts,
      toolTimings,
      ...(activeAssistant === undefined ? {} : { activeAssistant }),
      thinkingLevel: "off",
      model: null,
    },
  };
}

function promptMediaType(
  mimeType: string,
): Extract<SessionPromptContent, { type: "image" }>["mediaType"] {
  if (isInlineImageMediaType(mimeType)) return mimeType;
  throw new TypeError(`Unsupported Pi prompt image type: ${mimeType}`);
}

export function piPromptContent(
  text: string,
  images: readonly PiImageContent[] = [],
  textAttachmentIds: readonly string[] = [],
  fileAttachmentIds: readonly string[] = [],
  feedback: readonly PromptFeedbackItem[] = [],
): SessionPromptContent[] {
  const promptText = appendWorkspaceFeedbackContext(text, feedback);
  return [
    ...textAttachmentIds.map((attachmentId) => ({ type: "attachment" as const, attachmentId })),
    ...fileAttachmentIds.map((attachmentId) => ({ type: "file" as const, attachmentId })),
    ...(promptText ? [{ type: "text" as const, text: promptText }] : []),
    ...images.map((image) => ({
      type: "image" as const,
      mediaType: promptMediaType(image.mimeType),
      data: image.data,
      ...(image.name === undefined ? {} : { name: image.name }),
      ...(image.attachmentId === undefined ? {} : { attachmentId: image.attachmentId }),
    })),
    ...feedback
      .flatMap((item) => item.images ?? [])
      .map((image) => ({
        type: "image" as const,
        mediaType: promptMediaType(image.mimeType),
        data: image.data,
        ...(image.name === undefined ? {} : { name: image.name }),
      })),
  ];
}
