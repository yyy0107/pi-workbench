"use client";

import type { ToolCallBlock } from "@workbench/agent-runtime-contracts/conversation";
import { useEffect, useRef } from "react";

import { useConversationNodes, useConversationSession } from "./hooks";

/** Read the first non-empty string argument matching one of the supplied protocol field names. */
export function toolStringArg(args: unknown, ...keys: string[]): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) return record[key] as string;
  }
  return undefined;
}

/** Extract the common text payload shapes returned by tool adapters. */
export function toolResultText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return undefined;
  const candidate = result as Record<string, unknown>;
  if (typeof candidate.text === "string") return candidate.text;
  if (typeof candidate.content === "string") return candidate.content;
  return undefined;
}

/** Observe completed tool calls once per runtime session. */
export function useCompletedToolCalls(handle: (part: ToolCallBlock) => boolean): void {
  const nodes = useConversationNodes();
  const sessionId = useConversationSession().id;
  const seen = useRef(new Set<string>());

  useEffect(() => {
    seen.current.clear();
  }, [sessionId]);

  useEffect(() => {
    for (const node of nodes) {
      if (node.kind !== "assistant") continue;
      for (const block of node.blocks) {
        if (block.kind !== "tool-call" || seen.current.has(block.callId)) continue;
        if (handle(block)) seen.current.add(block.callId);
      }
    }
  }, [handle, nodes]);
}
