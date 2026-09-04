"use client";

import { useAuiState, type MessagePartState } from "@assistant-ui/react";
import { useEffect, useRef } from "react";

import { useCurrentSession } from "./hooks";

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

/**
 * Observe completed tool calls once per assistant-ui thread.
 *
 * Returning `true` marks a call as consumed. Returning `false` leaves it eligible for a later pass,
 * which lets a feature wait until streaming arguments or results are complete.
 */
export function useCompletedToolCalls(
  handle: (part: Extract<MessagePartState, { type: "tool-call" }>) => boolean,
): void {
  const messages = useAuiState((state) => state.thread.messages);
  const threadId = useCurrentSession().sessionId;
  const seen = useRef(new Set<string>());

  useEffect(() => {
    seen.current.clear();
  }, [threadId]);

  useEffect(() => {
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== "tool-call" || seen.current.has(part.toolCallId)) continue;
        if (handle(part)) seen.current.add(part.toolCallId);
      }
    }
  }, [handle, messages]);
}
