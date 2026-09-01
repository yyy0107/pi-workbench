"use client";

import { CheckIcon, CircleXIcon, CopyIcon } from "lucide-react";

import { TooltipIconButton } from "./tooltip-icon-button";
import { useClipboardCopy } from "../hooks/use-clipboard-copy";
import { useI18n } from "../i18n";
import { cn } from "../utils";

export interface CodexCodeHeaderProps {
  code: string;
  language?: string;
  className?: string;
}

export function CodexCodeHeader({ code, language, className }: CodexCodeHeaderProps) {
  const { t } = useI18n();
  const { copy, isCopied, status } = useClipboardCopy();
  const displayedLanguage = displayCodeLanguage(language, t("assistant.codeBlock.plainText"));
  const copyLabel = t(
    status === "copied"
      ? "assistant.actions.copied"
      : status === "failed"
        ? "assistant.actions.copyFailed"
        : "assistant.actions.copy",
  );

  return (
    <div className={cn("aui-codex-code-header", className)}>
      <span className="aui-codex-code-language">{displayedLanguage}</span>
      <TooltipIconButton tooltip={copyLabel} disabled={!code} onClick={() => void copy(code)}>
        {isCopied ? (
          <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
        ) : status === "failed" ? (
          <CircleXIcon className="text-destructive animate-in zoom-in-50 fade-in duration-200 ease-out" />
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
