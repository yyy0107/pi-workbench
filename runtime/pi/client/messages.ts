import type {
  AppendMessage,
  ThreadAssistantMessage,
  ThreadMessage,
  ThreadUserMessage,
  ToolCallMessagePart,
} from "@assistant-ui/react";

import type {
  PiAgentMessage,
  PiAssistantMessage,
  PiImageContent,
  PiSessionHistory,
  PiToolResultMessage,
} from "../contracts";

function messageDate(timestamp: number | undefined, index: number): Date {
  return new Date(timestamp ?? index);
}

function metadata(custom: Record<string, unknown> = {}) {
  return { custom };
}

function imageUrl(image: PiImageContent): string {
  if (image.data.startsWith("data:") || /^https?:\/\//i.test(image.data)) return image.data;
  return `data:${image.mimeType};base64,${image.data}`;
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

export function piAssistantToThreadMessage(
  message: PiAssistantMessage,
  id: string,
  {
    optimistic = false,
    streaming = false,
  }: Readonly<{ optimistic?: boolean; streaming?: boolean }> = {},
): ThreadMessage {
  let content: ThreadAssistantMessage["content"] = message.content.map((part) => {
    switch (part.type) {
      case "text":
        return {
          type: "text" as const,
          text: part.text,
          status: streaming ? ({ type: "running" } as const) : ({ type: "complete" } as const),
        };
      case "thinking":
        return {
          type: "reasoning" as const,
          text: part.redacted ? "" : part.thinking,
          status: streaming ? ({ type: "running" } as const) : ({ type: "complete" } as const),
        };
      case "image":
        return { type: "image" as const, image: imageUrl(part) };
      case "toolCall":
        return {
          type: "tool-call" as const,
          toolCallId: part.id,
          toolName: part.name,
          args: part.arguments as ToolCallMessagePart["args"],
          argsText: JSON.stringify(part.arguments),
        };
    }
  });
  if (streaming && content.length === 0) {
    content = [{ type: "text", text: "", status: { type: "running" } }];
  }

  return {
    id,
    role: "assistant",
    content,
    status: assistantStatus(message, streaming),
    createdAt: messageDate(message.timestamp, 0),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      ...(optimistic ? { isOptimistic: true } : {}),
      custom: {
        piModel: message.model,
        piProvider: message.provider,
      },
    },
  };
}

function applyToolResult(messages: ThreadMessage[], result: PiToolResultMessage): void {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message || message.role !== "assistant") continue;
    if (
      !message.content.some(
        (part) => part.type === "tool-call" && part.toolCallId === result.toolCallId,
      )
    ) {
      continue;
    }

    const text = messageContentText(result.content);
    const output = result.details === undefined ? text : { text, details: result.details };
    messages[index] = {
      ...message,
      content: message.content.map((part) =>
        part.type === "tool-call" && part.toolCallId === result.toolCallId
          ? ({ ...part, result: output, isError: result.isError } satisfies ToolCallMessagePart)
          : part,
      ),
    };
    return;
  }
}

function piMessageId(history: PiSessionHistory, index: number): string {
  const entryId = history.context.entryIds[index] ?? `message-${index}`;
  const previousMatches = history.context.entryIds
    .slice(0, index)
    .filter((candidate) => candidate === entryId).length;
  return previousMatches ? `${entryId}-${previousMatches}` : entryId;
}

export function piHistoryToThreadMessages(history: PiSessionHistory): ThreadMessage[] {
  const messages: ThreadMessage[] = [];

  history.context.messages.forEach((message, index) => {
    const id = piMessageId(history, index);
    switch (message.role) {
      case "user": {
        const content =
          typeof message.content === "string"
            ? [{ type: "text" as const, text: message.content }]
            : message.content.map((part) =>
                part.type === "image"
                  ? { type: "image" as const, image: imageUrl(part) }
                  : { type: "text" as const, text: part.text },
              );
        messages.push({
          id,
          role: "user",
          content,
          attachments: [],
          createdAt: messageDate(message.timestamp, index),
          metadata: metadata({ piEntryId: history.context.entryIds[index] }),
        });
        break;
      }
      case "assistant":
        messages.push(piAssistantToThreadMessage(message, id));
        break;
      case "toolResult":
        applyToolResult(messages, message);
        break;
      case "custom":
        if (message.display) {
          messages.push({
            id,
            role: "system",
            content: [{ type: "text", text: messageContentText(message.content) }],
            createdAt: messageDate(message.timestamp, index),
            metadata: metadata({ piCustomType: message.customType }),
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
          createdAt: messageDate(message.timestamp, index),
          metadata: metadata({ piBashExecution: true }),
        });
        break;
    }
  });

  return messages;
}

function splitDataUrl(value: string, fallbackMimeType: string): PiImageContent {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(value);
  return {
    type: "image",
    mimeType: match?.[1] ?? fallbackMimeType,
    data: match?.[2] ?? value,
  };
}

export function appendMessageToPiPrompt(message: AppendMessage): {
  text: string;
  images: PiImageContent[];
} {
  const text = message.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const images: PiImageContent[] = [];

  const collect = (part: (typeof message.content)[number]) => {
    if (part.type === "image") {
      images.push(splitDataUrl(part.image, "image/png"));
    } else if (part.type === "file" && part.mimeType.startsWith("image/")) {
      images.push(splitDataUrl(part.data, part.mimeType));
    }
  };
  message.content.forEach(collect);
  message.attachments?.forEach((attachment) => attachment.content.forEach(collect));

  return { text, images };
}

export function optimisticUserMessage(message: AppendMessage, id: string): ThreadMessage {
  const content: ThreadUserMessage["content"] = message.content.filter(
    (part): part is ThreadUserMessage["content"][number] =>
      part.type === "text" ||
      part.type === "image" ||
      part.type === "file" ||
      part.type === "data" ||
      part.type === "audio",
  );
  return {
    id,
    role: "user",
    content,
    attachments: message.attachments ?? [],
    createdAt: message.createdAt,
    metadata: { ...metadata({ piOptimistic: true }), isOptimistic: true },
  };
}

export function eventMessage(event: Record<string, unknown>): PiAgentMessage | undefined {
  const message = event.message;
  if (!message || typeof message !== "object" || !("role" in message)) return undefined;
  return message as PiAgentMessage;
}
