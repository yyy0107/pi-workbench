import type {
  AssistantMessageNode,
  ConversationData,
  ConversationError,
  ConversationNode,
  MessageBlock,
  ToolCallBlock,
} from "@workbench/agent-runtime-contracts/conversation";
import { isComposerJsonValue } from "@workbench/contracts/composer";
import { parseWorkbenchComposerCommandResponseDetails } from "@workbench/contracts/composer/request";
import {
  readWorkbenchParallelToolPresentationMetadata,
  readWorkbenchReasoningPresentationMetadata,
} from "@workbench/agent-runtime-client/message-presentation-metadata";

import { parsePiConversationEvent } from "../messages/conversation-events";
import type {
  PiConversationAssistantMessage as ThreadAssistantMessage,
  PiConversationMessage as ThreadMessage,
} from "./pi-conversation-message";

function createdAt(message: ThreadMessage): number | undefined {
  const value = message.createdAt.getTime();
  return Number.isFinite(value) ? value : undefined;
}

function serializable(value: unknown): ConversationData {
  if (isComposerJsonValue(value)) return value;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : (JSON.parse(json) as ConversationData);
  } catch {
    return String(value);
  }
}

function error(code: string, value: unknown): ConversationError {
  return Object.freeze({
    code,
    message: typeof value === "string" ? value : JSON.stringify(serializable(value)),
  });
}

function mediaType(source: string, fallback?: string): string | undefined {
  return fallback ?? /^data:([^;,]+)/.exec(source)?.[1];
}

function toolStatus(
  part: Extract<ThreadAssistantMessage["content"][number], { type: "tool-call" }>,
  message: ThreadAssistantMessage,
): ToolCallBlock["status"] {
  if (
    part.interrupt ||
    (part.approval &&
      part.approval.approved === undefined &&
      part.approval.resolution === undefined)
  ) {
    return "requires-action";
  }
  if (part.result !== undefined) return part.isError ? "error" : "complete";
  return message.status.type === "running" ? "running" : "incomplete";
}

function assistantStatus(message: ThreadAssistantMessage): AssistantMessageNode["status"] {
  if (message.status.type === "running" || message.status.type === "requires-action") {
    return "running";
  }
  if (message.status.type === "complete") return "complete";
  return message.status.reason === "error" ? "error" : "incomplete";
}

function reasoningTiming(
  part: Extract<ThreadAssistantMessage["content"][number], { type: "reasoning" }>,
) {
  const timing = readWorkbenchReasoningPresentationMetadata(part.providerMetadata);
  if (!timing) return undefined;
  if (timing.durationMs !== undefined) {
    const startedAt = timing.startedAt ?? 0;
    return { startedAt, completedAt: startedAt + timing.durationMs };
  }
  return timing.startedAt === undefined ? undefined : { startedAt: timing.startedAt };
}

function blocks(message: ThreadMessage): MessageBlock[] {
  const counts = new Map<string, number>();
  const key = (kind: string, identity?: string): string => {
    const stem = `${message.id}:${kind}${identity ? `:${encodeURIComponent(identity)}` : ""}`;
    const count = counts.get(stem) ?? 0;
    counts.set(stem, count + 1);
    return count === 0 ? stem : `${stem}:${count}`;
  };
  const projected: MessageBlock[] = [];

  for (const part of message.content) {
    switch (part.type) {
      case "text":
        projected.push({ key: key("text"), kind: "text", text: part.text });
        break;
      case "reasoning": {
        const timing = reasoningTiming(part);
        projected.push({
          key: key("reasoning"),
          kind: "reasoning",
          text: part.text,
          ...(part.status === undefined ? {} : { status: part.status.type }),
          ...(timing === undefined ? {} : { timing }),
        });
        break;
      }
      case "tool-call": {
        if (message.role !== "assistant") break;
        const status = toolStatus(part, message);
        const parallelGroup = readWorkbenchParallelToolPresentationMetadata(part.providerMetadata);
        projected.push({
          key: key("tool", part.toolCallId),
          kind: "tool-call",
          callId: part.toolCallId,
          toolName: part.toolName,
          arguments: serializable(part.args),
          argumentsText: part.argsText,
          status,
          ...(status === "incomplete" && message.status.type === "incomplete"
            ? { incompleteReason: message.status.reason }
            : {}),
          ...(part.result === undefined ? {} : { result: serializable(part.result) }),
          ...(status !== "error" ? {} : { error: error("tool-error", part.result) }),
          ...(part.timing === undefined ? {} : { timing: part.timing }),
          ...(parallelGroup === undefined
            ? {}
            : {
                parallelGroup: {
                  key: parallelGroup.batchId,
                  size: parallelGroup.batchSize,
                },
              }),
        });
        break;
      }
      case "data":
        projected.push({
          key: key("data", part.name),
          kind: "data",
          name: part.name,
          data: serializable(part.data),
        });
        break;
      case "image": {
        const imageMediaType = mediaType(part.image);
        projected.push({
          key: key("file", part.filename),
          kind: "file",
          name: part.filename ?? "image",
          source: part.image,
          mediaType: imageMediaType ?? "image/png",
          ...(/^(?:data:|https?:\/\/|blob:)/i.test(part.image)
            ? { sourceType: "url" as const }
            : {}),
        });
        break;
      }
      case "file":
        projected.push({
          key: key("file", part.filename),
          kind: "file",
          name: part.filename ?? "file",
          source: part.data,
          mediaType: part.mimeType,
          ...(part.sourceType === undefined ? {} : { sourceType: part.sourceType }),
        });
        break;
      case "source":
        projected.push({
          key: key("source", part.id),
          kind: "source",
          ...(part.sourceType === "url" ? { url: part.url } : {}),
          ...(part.title ? { title: part.title } : {}),
          ...(part.sourceType === "document" && part.filename ? { filename: part.filename } : {}),
          ...(part.sourceType === "document" ? { mediaType: part.mediaType } : {}),
        });
        break;
      case "audio":
        projected.push({
          key: key("file"),
          kind: "file",
          name: "audio",
          source: part.audio.data,
          mediaType: `audio/${part.audio.format}`,
        });
        break;
      case "generative-ui":
        projected.push({
          key: key("data", part.id ?? "generative-ui"),
          kind: "data",
          name: "generative-ui",
          data: serializable(part.spec),
        });
        break;
    }
  }

  if (
    message.role === "assistant" &&
    message.status.type === "incomplete" &&
    message.status.reason === "error" &&
    !projected.some((block) => block.kind === "error")
  ) {
    projected.push({
      key: key("error"),
      kind: "error",
      error: error("assistant-error", message.status.error ?? "Assistant response failed"),
    });
  }
  return projected;
}

function node(message: ThreadMessage): ConversationNode {
  const timestamp = createdAt(message);
  if (message.role === "user") {
    return {
      key: message.id,
      kind: "user",
      blocks: blocks(message),
      ...(timestamp === undefined ? {} : { createdAt: timestamp }),
    };
  }
  if (message.role === "assistant") {
    return {
      key: message.id,
      kind: "assistant",
      blocks: blocks(message),
      status: assistantStatus(message),
      ...(timestamp === undefined ? {} : { createdAt: timestamp }),
    };
  }

  const command = parseWorkbenchComposerCommandResponseDetails(
    message.metadata.custom.workbenchComposerCommandResponse,
  );
  if (command) {
    return {
      key: message.id,
      kind: "command",
      name: command.label || command.commandId,
      ...(command.args === undefined ? {} : { input: JSON.stringify(command.args) }),
      ...(command.failureReason === undefined ? {} : { output: command.failureReason }),
      status:
        command.status === "running"
          ? "running"
          : command.status === "success"
            ? "complete"
            : "error",
      ...(timestamp === undefined ? {} : { createdAt: timestamp }),
    };
  }

  const event = parsePiConversationEvent(message.metadata.custom.piConversationEvent);
  if (event?.kind === "compaction") {
    return {
      key: message.id,
      kind: "compaction",
      summary: event.reason,
      ...(timestamp === undefined ? {} : { createdAt: timestamp }),
    };
  }
  return {
    key: message.id,
    kind: "system",
    blocks: blocks(message),
    ...(timestamp === undefined ? {} : { createdAt: timestamp }),
  };
}

/**
 * Project Pi-owned normalized history/live state into backend-neutral Workbench nodes.
 */
export function conversationNodesFromPiConversation(
  messages: readonly ThreadMessage[],
): readonly ConversationNode[] {
  return messages.map(node);
}
