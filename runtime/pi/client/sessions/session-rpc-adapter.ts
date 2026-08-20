import type {
  PiAgentMessage,
  PiAssistantMessage,
  PiConversationEvent,
  PiImageContent,
  PiSessionHistory,
  PiSessionSummary,
  PiWorkspaceSummary,
} from "../../contracts";
import type {
  SessionHistoryValue,
  SessionListItem,
  SessionPromptContent,
} from "../../rpc-contracts";
import {
  conversationEventFromSessionEvent,
  modelChangeConversationEvent,
  piConversationEventMessage,
} from "../messages/conversation-events";

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

  return {
    id: item.sessionId,
    cwd,
    workspace: projectedWorkspace(projected?.workspace, cwd),
    ...(stringValue(projected?.name) === undefined ? {} : { name: stringValue(projected?.name) }),
    created,
    modified: updatedAt,
    messageCount,
    firstMessage: stringValue(projected?.firstMessage) ?? "",
    transient: booleanValue(projected?.transient) ?? false,
    running: item.running,
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

/** Convert canonical session history events into the existing assistant-ui message projection. */
export function piHistoryFromSessionEvents(
  sessionId: string,
  history: SessionHistoryValue,
): PiSessionHistory {
  const messages: PiAgentMessage[] = [];
  const entryIds: string[] = [];
  const entryCompletedAts: Array<number | null> = [];
  const toolStarts = new Map<string, number>();
  const toolTimings: NonNullable<PiSessionHistory["context"]["toolTimings"]> = [];
  let currentModel: Pick<PiAssistantMessage, "model" | "provider"> | undefined;

  const pushMessage = (message: PiAgentMessage, entryId: string, completedAt: number) => {
    messages.push(message);
    entryIds.push(entryId);
    entryCompletedAts.push(completedAt);
  };

  const pushConversationEvent = (
    event: PiConversationEvent,
    entryId: string,
    timestamp: number,
  ) => {
    pushMessage(piConversationEventMessage(event, timestamp), entryId, timestamp);
  };

  const insertConversationEventBeforeLastMessage = (
    event: PiConversationEvent,
    entryId: string,
    fallbackTimestamp: number,
  ) => {
    const index = messages.length - 1;
    if (messages[index]?.role !== "user") {
      pushConversationEvent(event, entryId, fallbackTimestamp);
      return;
    }
    const timestamp = entryCompletedAts[index] ?? fallbackTimestamp;
    messages.splice(index, 0, piConversationEventMessage(event, timestamp));
    entryIds.splice(index, 0, entryId);
    entryCompletedAts.splice(index, 0, timestamp);
  };

  for (const { event } of history.events) {
    const data = record(event.data);
    if (event.type === "tool_execution_start" && typeof data?.toolCallId === "string") {
      toolStarts.set(data.toolCallId, event.time);
    } else if (event.type === "tool_execution_end" && typeof data?.toolCallId === "string") {
      const startedAt = toolStarts.get(data.toolCallId);
      if (startedAt !== undefined && event.time >= startedAt) {
        toolTimings.push({ toolCallId: data.toolCallId, startedAt, completedAt: event.time });
      }
    }

    const conversationEvent = conversationEventFromSessionEvent(event.type, event.data);
    if (conversationEvent) {
      pushConversationEvent(
        conversationEvent,
        `pi-event-${event.seq}:conversation-event`,
        event.time,
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

    if (message.role === "assistant" && message.model) {
      const derivedModelChange = currentModel
        ? modelChangeConversationEvent(
            message.model,
            message.provider,
            currentModel.model,
            currentModel.provider,
          )
        : undefined;
      if (derivedModelChange) {
        insertConversationEventBeforeLastMessage(
          derivedModelChange,
          `pi-event-${event.seq}:derived-model-change`,
          event.time,
        );
      }
      currentModel = { model: message.model, provider: message.provider };
    }

    pushMessage(message, `pi-event-${event.seq}`, event.time);
  }

  return {
    sessionId,
    context: {
      messages,
      entryIds,
      entryCompletedAts,
      toolTimings,
      thinkingLevel: "off",
      model: null,
    },
  };
}

function promptMediaType(
  mimeType: string,
): Extract<SessionPromptContent, { type: "image" }>["mediaType"] {
  switch (mimeType) {
    case "image/png":
    case "image/jpeg":
    case "image/webp":
    case "image/gif":
      return mimeType;
    default:
      throw new TypeError(`Unsupported Pi prompt image type: ${mimeType}`);
  }
}

export function piPromptContent(
  text: string,
  images: readonly PiImageContent[] = [],
): SessionPromptContent[] {
  return [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...images.map((image) => ({
      type: "image" as const,
      mediaType: promptMediaType(image.mimeType),
      data: image.data,
    })),
  ];
}
