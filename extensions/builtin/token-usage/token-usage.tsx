"use client";

import { useAuiState } from "@assistant-ui/react";
import { GaugeIcon } from "lucide-react";
import { useMemo } from "react";

import { useI18n } from "@/i18n";

function estimateTextTokens(text: string) {
  let estimate = 0;

  for (const character of text) {
    estimate += character.codePointAt(0)! > 0x2e7f ? 1 : 0.25;
  }

  return estimate;
}

export function TokenUsage() {
  const { t } = useI18n();
  const messages = useAuiState((state) => state.thread.messages);

  const tokenEstimate = useMemo(() => {
    let estimate = 0;

    for (const message of messages) {
      for (const part of message.content) {
        if (part.type === "text" || part.type === "reasoning") {
          estimate += estimateTextTokens(part.text);
        } else if (part.type === "tool-call") {
          estimate += estimateTextTokens(part.toolName);
          estimate += estimateTextTokens(part.argsText);
        }
      }
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
