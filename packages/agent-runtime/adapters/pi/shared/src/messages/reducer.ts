import { parseStreamingJson } from "@earendil-works/pi-ai";

import type {
  PiAssistantContent,
  PiAssistantMessage,
} from "@workbench/agent-runtime-pi-protocol/messages";
import type { SessionMessageDelta } from "@workbench/agent-runtime-pi-protocol/stream";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function copyPiAssistantMessage(message: PiAssistantMessage): PiAssistantMessage {
  return {
    ...message,
    content: message.content.map((part) =>
      part.type === "toolCall" ? { ...part, arguments: { ...part.arguments } } : { ...part },
    ),
    ...(message.usage === undefined ? {} : { usage: { ...message.usage } }),
    ...(message.diagnostics === undefined
      ? {}
      : { diagnostics: message.diagnostics.map((diagnostic) => ({ ...diagnostic })) }),
  };
}

function parsedToolArguments(json: string): Record<string, unknown> {
  const parsed = parseStreamingJson<unknown>(json);
  return isRecord(parsed) ? parsed : {};
}

function replaceContent(
  message: PiAssistantMessage,
  contentIndex: number,
  part: PiAssistantContent,
): PiAssistantMessage | undefined {
  if (contentIndex < 0 || contentIndex > message.content.length) return undefined;
  const content = [...message.content];
  content[contentIndex] = part;
  return { ...message, content };
}

/** Apply one validated pi-messages content event without mutating prior message snapshots. */
export function applySessionMessageDelta(
  message: PiAssistantMessage,
  toolCallJson: Map<number, string>,
  update: SessionMessageDelta,
): PiAssistantMessage | undefined {
  const index = update.contentIndex;
  const part = message.content[index];
  switch (update.type) {
    case "text_start":
      return replaceContent(message, index, { type: "text", text: "" });
    case "text_delta":
      return part?.type === "text"
        ? replaceContent(message, index, { ...part, text: `${part.text}${update.delta}` })
        : undefined;
    case "text_end":
      return part?.type === "text"
        ? replaceContent(message, index, {
            type: "text",
            text: update.content,
            ...(update.contentSignature === undefined
              ? {}
              : { textSignature: update.contentSignature }),
          })
        : undefined;
    case "thinking_start":
      return replaceContent(message, index, { type: "thinking", thinking: "" });
    case "thinking_delta":
      return part?.type === "thinking"
        ? replaceContent(message, index, {
            ...part,
            thinking: `${part.thinking}${update.delta}`,
          })
        : undefined;
    case "thinking_end":
      return part?.type === "thinking"
        ? replaceContent(message, index, {
            type: "thinking",
            thinking: update.content,
            ...(update.contentSignature === undefined
              ? {}
              : { thinkingSignature: update.contentSignature }),
            ...(update.redacted === undefined ? {} : { redacted: update.redacted }),
          })
        : undefined;
    case "toolcall_start":
      toolCallJson.set(index, "");
      return replaceContent(message, index, {
        type: "toolCall",
        id: update.id,
        name: update.toolName,
        arguments: {},
      });
    case "toolcall_delta": {
      if (part?.type !== "toolCall" || !toolCallJson.has(index)) return undefined;
      const json = `${toolCallJson.get(index) ?? ""}${update.delta}`;
      toolCallJson.set(index, json);
      return replaceContent(message, index, {
        ...part,
        arguments: parsedToolArguments(json),
      });
    }
    case "toolcall_end":
      if (part?.type !== "toolCall") return undefined;
      toolCallJson.delete(index);
      return replaceContent(message, index, update.toolCall);
  }
}
