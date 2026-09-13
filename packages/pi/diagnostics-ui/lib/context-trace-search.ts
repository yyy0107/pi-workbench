import type {
  SessionContextTraceEvent,
  SessionContextTraceEventSummary,
} from "@workbench/agent-runtime-pi-protocol/rpc";

import {
  listContextTraceMessages,
  listContextTraceOutputBlocks,
  type ContextTraceMessageRole,
  type ContextTraceOutputBlockKind,
} from "./context-trace-messages";

export type ContextTraceSearchMatch =
  | {
      type: "user-prompt";
      traceId: string;
      focusKey: "prompt:user-prompt";
      snippet: string;
    }
  | {
      type: "context-message";
      traceId: string;
      focusKey: string;
      snippet: string;
      role: ContextTraceMessageRole;
      sourceIndex: number;
      toolName?: string;
    }
  | {
      type: "output-block";
      traceId: string;
      focusKey: string;
      snippet: string;
      blockKind: ContextTraceOutputBlockKind;
      contentIndex: number;
      toolName?: string;
      toolCallId?: string;
    };

export function normalizeContextTraceSearchText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function contextTraceSearchSnippet(
  text: string,
  normalizedQuery: string,
): string | undefined {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  const matchIndex = normalizedText.toLocaleLowerCase().indexOf(normalizedQuery);
  if (matchIndex < 0) return undefined;

  const start = Math.max(0, matchIndex - 56);
  const end = Math.min(normalizedText.length, matchIndex + normalizedQuery.length + 80);
  return `${start > 0 ? "…" : ""}${normalizedText.slice(start, end)}${end < normalizedText.length ? "…" : ""}`;
}

export function contextTraceEventSearchMatches(
  event: SessionContextTraceEvent,
  normalizedQuery: string,
): readonly ContextTraceSearchMatch[] {
  if (!normalizedQuery) return [];

  if (event.kind === "prompt-composition") {
    const snippet = contextTraceSearchSnippet(event.detail.prompt.text, normalizedQuery);
    return snippet
      ? [{ type: "user-prompt", traceId: event.traceId, focusKey: "prompt:user-prompt", snippet }]
      : [];
  }

  if (event.kind === "context-snapshot") {
    return listContextTraceMessages(event.detail.messages.value).flatMap((message) => {
      const snippet = contextTraceSearchSnippet(message.text, normalizedQuery);
      return snippet
        ? [
            {
              type: "context-message" as const,
              traceId: event.traceId,
              focusKey: `context-message:${message.sourceIndex}`,
              snippet,
              role: message.role,
              sourceIndex: message.sourceIndex,
              ...(message.toolName ? { toolName: message.toolName } : {}),
            },
          ]
        : [];
    });
  }

  if (event.kind === "model-output" || event.kind === "turn-end") {
    return listContextTraceOutputBlocks(event.detail.message.value).flatMap((block) => {
      const snippet = contextTraceSearchSnippet(block.text, normalizedQuery);
      return snippet
        ? [
            {
              type: "output-block" as const,
              traceId: event.traceId,
              focusKey: `output-block:${block.contentIndex}:content`,
              snippet,
              blockKind: block.kind,
              contentIndex: block.contentIndex,
              ...(block.toolName ? { toolName: block.toolName } : {}),
              ...(block.toolCallId ? { toolCallId: block.toolCallId } : {}),
            },
          ]
        : [];
    });
  }

  return [];
}

export function isContextTraceMessageContentEvent(event: SessionContextTraceEventSummary): boolean {
  return (
    event.kind === "prompt-composition" ||
    event.kind === "context-snapshot" ||
    event.kind === "model-output" ||
    event.kind === "turn-end"
  );
}
