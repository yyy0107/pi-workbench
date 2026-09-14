import type {
  RemoteConversationItemV1,
  RemoteConversationNodeV1,
  RemoteToolCallV1,
} from "@workbench/remote-control-contracts/protocol";
import type {
  ConversationNode,
  MessageBlock,
} from "@workbench/agent-runtime-contracts/conversation";

type RemoteToolResult = Extract<RemoteConversationItemV1, { type: "tool-result" }>;
type RemoteAssistantMessage = Extract<RemoteConversationItemV1, { type: "assistant-message" }>;

export interface RemoteTranscriptTool {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: string;
  readonly output: string;
  readonly running: boolean;
  readonly failed: boolean;
  readonly truncated: boolean;
}

export type RemoteTranscriptEntry =
  | {
      readonly kind: "user";
      readonly item: Extract<RemoteConversationItemV1, { type: "user-message" }>;
    }
  | {
      readonly kind: "assistant";
      readonly item: RemoteAssistantMessage;
      readonly tools: readonly RemoteTranscriptTool[];
    }
  | {
      readonly kind: "tool";
      readonly item: RemoteToolResult;
      readonly tool: RemoteTranscriptTool;
    }
  | {
      readonly kind: "activity";
      readonly item: Extract<RemoteConversationItemV1, { type: "activity-summary" }>;
    }
  | {
      readonly kind: "system";
      readonly item: Extract<RemoteConversationItemV1, { type: "system-status" }>;
    };

function transcriptTool(call: RemoteToolCallV1, result?: RemoteToolResult): RemoteTranscriptTool {
  return Object.freeze({
    toolCallId: call.toolCallId,
    toolName: result?.toolName ?? call.toolName,
    input: result?.input ?? call.arguments,
    output: result?.output ?? "",
    running: result === undefined,
    failed: result?.isError ?? false,
    truncated: call.truncated || (result?.truncated ?? false),
  });
}

function standaloneTool(result: RemoteToolResult): RemoteTranscriptTool {
  return Object.freeze({
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    input: result.input ?? "",
    output: result.output,
    running: false,
    failed: result.isError,
    truncated: result.truncated,
  });
}

/**
 * Joins a projected tool result to its visible assistant tool call without altering wire data.
 * Ordinary questions stay native-owned and are intentionally omitted from the DOM transcript.
 */
export function remoteConversationTranscript(
  items: readonly RemoteConversationItemV1[],
): readonly RemoteTranscriptEntry[] {
  const results = new Map<string, RemoteToolResult>();
  const visibleCallIds = new Set<string>();
  for (const item of items) {
    if (item.type === "tool-result") results.set(item.toolCallId, item);
    if (item.type === "assistant-message") {
      for (const call of item.toolCalls ?? []) visibleCallIds.add(call.toolCallId);
    }
  }

  return items.flatMap((item): readonly RemoteTranscriptEntry[] => {
    switch (item.type) {
      case "conversation-node":
      case "ordinary-question":
        return [];
      case "user-message":
        return [{ kind: "user", item }];
      case "assistant-message":
        return [
          {
            kind: "assistant",
            item,
            tools: (item.toolCalls ?? []).map((call) =>
              transcriptTool(call, results.get(call.toolCallId)),
            ),
          },
        ];
      case "tool-result":
        return visibleCallIds.has(item.toolCallId)
          ? []
          : [{ kind: "tool", item, tool: standaloneTool(item) }];
      case "activity-summary":
        return [{ kind: "activity", item }];
      case "system-status":
        return [{ kind: "system", item }];
    }
  });
}

function canonicalBlock(
  block: NonNullable<RemoteConversationNodeV1["blocks"]>[number],
): MessageBlock {
  switch (block.kind) {
    case "text":
      return { kind: "text", key: block.key, text: block.text };
    case "reasoning":
      return {
        kind: "reasoning",
        key: block.key,
        text: block.text,
        ...(block.status ? { status: block.status } : {}),
      };
    case "tool-call": {
      return {
        kind: "tool-call",
        key: block.key,
        callId: block.callId,
        toolName: block.toolName,
        argumentsText: block.argumentsText,
        status: block.status,
        ...(block.result === undefined ? {} : { result: block.result }),
        ...(block.error === undefined ? {} : { error: block.error }),
      };
    }
    case "data":
      return { kind: "data", key: block.key, name: block.name, data: block.data };
    case "error":
      return { kind: "error", key: block.key, error: block.error };
  }
  throw new Error("Unsupported remote conversation block");
}

function canonicalNode(item: RemoteConversationNodeV1): ConversationNode {
  const createdAt = Date.parse(item.createdAt);
  const base = Number.isFinite(createdAt) ? { createdAt } : {};
  const blocks = item.blocks?.map(canonicalBlock) ?? [];
  switch (item.kind) {
    case "user":
      return { key: item.itemId, kind: "user", blocks, ...base };
    case "assistant":
      return {
        key: item.itemId,
        kind: "assistant",
        blocks,
        status: item.status ?? "incomplete",
        ...base,
      };
    case "system":
      return { key: item.itemId, kind: "system", blocks, ...base };
    case "command":
      return {
        key: item.itemId,
        kind: "command",
        name: item.name ?? "command",
        ...(item.input === undefined ? {} : { input: item.input }),
        ...(item.output === undefined ? {} : { output: item.output }),
        status:
          item.status === "running" || item.status === "complete" || item.status === "error"
            ? item.status
            : "error",
        ...base,
      };
    case "compaction":
      return {
        key: item.itemId,
        kind: "compaction",
        ...(item.summary === undefined ? {} : { summary: item.summary }),
        ...base,
      };
    case "error":
      return {
        key: item.itemId,
        kind: "error",
        error: item.error ?? { code: "remote-error", message: "Conversation error" },
        ...base,
      };
  }
}

/**
 * Rehydrates the desktop-owned canonical render model. Legacy item variants remain readable so an
 * app update can display an older encrypted cache before the first authoritative refresh.
 */
export function remoteConversationNodes(
  items: readonly RemoteConversationItemV1[],
): readonly ConversationNode[] {
  const canonical = items.filter(
    (item): item is RemoteConversationNodeV1 => item.type === "conversation-node",
  );
  if (canonical.length > 0) return canonical.map(canonicalNode);

  return remoteConversationTranscript(items).flatMap((entry): readonly ConversationNode[] => {
    if (entry.kind === "user") {
      return [
        {
          key: entry.item.itemId,
          kind: "user",
          createdAt: Date.parse(entry.item.createdAt),
          blocks: [{ key: `${entry.item.itemId}:text`, kind: "text", text: entry.item.text }],
        },
      ];
    }
    if (entry.kind === "assistant") {
      const blocks: MessageBlock[] = [];
      for (const tool of entry.tools) {
        blocks.push({
          key: `${entry.item.itemId}:tool:${tool.toolCallId}`,
          kind: "tool-call",
          callId: tool.toolCallId,
          toolName: tool.toolName,
          argumentsText: tool.input,
          status: tool.running ? "running" : tool.failed ? "error" : "complete",
          ...(tool.output ? { result: tool.output } : {}),
          ...(tool.failed ? { error: { code: "tool-error", message: tool.output } } : {}),
        });
      }
      if (entry.item.text) {
        blocks.push({ key: `${entry.item.itemId}:text`, kind: "text", text: entry.item.text });
      }
      return [
        {
          key: entry.item.itemId,
          kind: "assistant",
          createdAt: Date.parse(entry.item.createdAt),
          status:
            entry.item.state === "streaming"
              ? "running"
              : entry.item.state === "failed"
                ? "error"
                : "complete",
          blocks,
        },
      ];
    }
    if (entry.kind === "tool") {
      return [
        {
          key: entry.item.itemId,
          kind: "assistant",
          createdAt: Date.parse(entry.item.createdAt),
          status: entry.tool.failed ? "error" : "complete",
          blocks: [
            {
              key: `${entry.item.itemId}:tool:${entry.tool.toolCallId}`,
              kind: "tool-call",
              callId: entry.tool.toolCallId,
              toolName: entry.tool.toolName,
              argumentsText: entry.tool.input,
              status: entry.tool.failed ? "error" : "complete",
              result: entry.tool.output,
              ...(entry.tool.failed
                ? { error: { code: "tool-error", message: entry.tool.output } }
                : {}),
            },
          ],
        },
      ];
    }
    return [];
  });
}
