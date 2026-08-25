"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useI18n } from "@/i18n";
import { writeClipboardText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

export interface CodexCodeHeaderProps {
  code: string;
  language?: string;
  className?: string;
}

export function CodexCodeHeader({ code, language, className }: CodexCodeHeaderProps) {
  const { t } = useI18n();
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const displayedLanguage = displayCodeLanguage(language, t("assistant.codeBlock.plainText"));

  return (
    <div className={cn("aui-codex-code-header", className)}>
      <span className="aui-codex-code-language">{displayedLanguage}</span>
      <TooltipIconButton
        tooltip={t("assistant.actions.copy")}
        disabled={!code}
        onClick={() => copyToClipboard(code)}
      >
        {isCopied ? (
          <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
        ) : (
          <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
        )}
      </TooltipIconButton>
    </div>
  );
}

export function displayCodeLanguage(language: string | undefined, plainTextLabel: string): string {
  const normalized = language?.trim().toLowerCase();

  if (!normalized || normalized === "unknown" || normalized === "text") return plainTextLabel;
  if (normalized === "js" || normalized === "javascript") return "JavaScript";
  if (normalized === "ts" || normalized === "typescript") return "TypeScript";
  if (normalized === "jsx") return "JSX";
  if (normalized === "tsx") return "TSX";

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function useCopyToClipboard({ copiedDuration = 3000 }: { copiedDuration?: number } = {}) {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = (value: string) => {
    if (!value || isCopied) return;

    void writeClipboardText(value).then((copied) => {
      if (copied) {
        setIsCopied(true);
        window.setTimeout(() => setIsCopied(false), copiedDuration);
      }
    });
  };

  return { isCopied, copyToClipboard };
}
