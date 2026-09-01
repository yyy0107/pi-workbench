import type {
  ThreadAssistantMessage,
  ThreadMessage,
  ToolCallMessagePart,
} from "@assistant-ui/react";

export function findBashToolCallMessage(
  messages: readonly ThreadMessage[],
  toolCallId: string,
): ThreadAssistantMessage | undefined {
  return messages.find(
    (message): message is ThreadAssistantMessage =>
      message.role === "assistant" &&
      message.content.some(
        (part) =>
          part.type === "tool-call" && part.toolName === "bash" && part.toolCallId === toolCallId,
      ),
  );
}

export function findBashToolCall(
  messages: readonly ThreadMessage[],
  toolCallId: string,
): ToolCallMessagePart | undefined {
  return findBashToolCallMessage(messages, toolCallId)?.content.find(
    (part): part is ToolCallMessagePart =>
      part.type === "tool-call" && part.toolName === "bash" && part.toolCallId === toolCallId,
  );
}

export function bashCommandFromArgs(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const command = (args as { command?: unknown }).command;
  return typeof command === "string" && command.length > 0 ? command : undefined;
}

export function terminalResultText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return undefined;
  const text = (result as { text?: unknown }).text;
  if (typeof text === "string") return text;

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

export function terminalResultLines(result: unknown): string[] {
  const output = terminalResultText(result);
  if (!output) return [];
  return output.replace(/\r\n?/g, "\n").split("\n");
}

export function terminalOutputAppendDelta(previous: string, next: string): string | undefined {
  return next.startsWith(previous) ? next.slice(previous.length) : undefined;
}
