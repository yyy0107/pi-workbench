import type {
  AssistantMessageNode,
  ConversationNode,
  ToolCallBlock,
} from "@workbench/agent-runtime-contracts/conversation";

export function findBashToolCallMessage(
  nodes: readonly ConversationNode[],
  toolCallId: string,
): AssistantMessageNode | undefined {
  return nodes.find(
    (node): node is AssistantMessageNode =>
      node.kind === "assistant" &&
      node.blocks.some(
        (block) =>
          block.kind === "tool-call" && block.toolName === "bash" && block.callId === toolCallId,
      ),
  );
}

export function findBashToolCall(
  nodes: readonly ConversationNode[],
  toolCallId: string,
): ToolCallBlock | undefined {
  return findBashToolCallMessage(nodes, toolCallId)?.blocks.find(
    (block): block is ToolCallBlock =>
      block.kind === "tool-call" && block.toolName === "bash" && block.callId === toolCallId,
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
