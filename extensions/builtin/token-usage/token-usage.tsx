"use client";

import { useAuiState, type ThreadMessage } from "@assistant-ui/react";
import { GaugeIcon } from "lucide-react";
import { useMemo, useRef } from "react";

import { useI18n } from "@/i18n";

function estimateTextTokens(text: string) {
  let estimate = 0;

  for (const character of text) {
    estimate += character.codePointAt(0)! > 0x2e7f ? 1 : 0.25;
  }

  return estimate;
}

function estimateMessageTokens(message: ThreadMessage) {
  let estimate = 0;

  for (const part of message.content) {
    if (part.type === "text" || part.type === "reasoning") {
      estimate += estimateTextTokens(part.text);
    } else if (part.type === "tool-call") {
      estimate += estimateTextTokens(part.toolName);
      estimate += estimateTextTokens(part.argsText);
    }
  }

  return estimate;
}

function hasSameTokenInput(
  previous: ThreadMessage["content"],
  next: ThreadMessage["content"],
): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;

  return previous.every((part, index) => {
    const candidate = next[index];
    if (!candidate || part.type !== candidate.type) return false;

    if (part.type === "text" && candidate.type === "text") {
      return part.text === candidate.text;
    }
    if (part.type === "reasoning" && candidate.type === "reasoning") {
      return part.text === candidate.text;
    }
    if (part.type === "tool-call" && candidate.type === "tool-call") {
      return part.toolName === candidate.toolName && part.argsText === candidate.argsText;
    }
    return true;
  });
}

interface CachedMessageEstimate {
  content: ThreadMessage["content"];
  estimate: number;
}

export function TokenUsage() {
  const { t } = useI18n();
  const messages = useAuiState((state) => state.thread.messages);
  const cache = useRef(new Map<string, CachedMessageEstimate>());

  const tokenEstimate = useMemo(() => {
    let estimate = 0;
    const activeMessageIds = new Set<string>();

    for (const message of messages) {
      activeMessageIds.add(message.id);
      const cached = cache.current.get(message.id);
      if (cached && hasSameTokenInput(cached.content, message.content)) {
        estimate += cached.estimate;
        continue;
      }

      const messageEstimate = estimateMessageTokens(message);
      cache.current.set(message.id, { content: message.content, estimate: messageEstimate });
      estimate += messageEstimate;
    }

    for (const messageId of cache.current.keys()) {
      if (!activeMessageIds.has(messageId)) cache.current.delete(messageId);
    }

    return Math.ceil(estimate);
  }, [messages]);

  return (
    <div
      aria-label={t("extensions.tokenUsage.accessibleLabel", { count: tokenEstimate })}
      className="inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 font-mono text-[11px] tracking-tight text-muted-foreground tabular-nums"
      title={t("extensions.tokenUsage.description")}
    >
      <GaugeIcon aria-hidden="true" className="size-3" />
      <span>{t("extensions.tokenUsage.display", { count: tokenEstimate })}</span>
    </div>
  );
}
