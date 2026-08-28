"use client";

import { CheckIcon, CircleXIcon, CopyIcon } from "lucide-react";

import { MarkdownTextContent } from "@/components/assistant-ui/lazy-markdown-text";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useClipboardCopy } from "@/hooks/use-clipboard-copy";
import { useI18n } from "@/i18n";

const COPY_FEEDBACK_DURATION_MS = 2_000;

export function FileMarkdownPreview({
  ariaLabel,
  content,
}: Readonly<{
  ariaLabel: string;
  content: string;
}>) {
  const { t } = useI18n();
  const { copy, isCopied, status } = useClipboardCopy({
    duration: COPY_FEEDBACK_DURATION_MS,
  });
  const copyLabel = t(
    status === "copied"
      ? "extensions.workspaceFile.markdownCopied"
      : status === "failed"
        ? "extensions.workspaceFile.markdownCopyFailed"
        : "extensions.workspaceFile.copyMarkdown",
  );

  return (
    <div className="relative h-full bg-transparent">
      <TooltipIconButton
        tooltip={copyLabel}
        aria-label={copyLabel}
        data-frame="none"
        className="text-muted-foreground hover:text-foreground absolute top-3 end-3 z-10 size-7 bg-transparent hover:bg-transparent dark:hover:bg-transparent"
        onClick={() => void copy(content)}
      >
        {isCopied ? (
          <CheckIcon className="size-4" />
        ) : status === "failed" ? (
          <CircleXIcon className="text-destructive size-4" />
        ) : (
          <CopyIcon className="size-4" />
        )}
      </TooltipIconButton>
      <div role="document" aria-label={ariaLabel} className="h-full overflow-auto">
        <article className="mx-auto w-full max-w-4xl px-8 py-7 pe-14 text-sm leading-7 break-words">
          <MarkdownTextContent text={content} defer={false} mode="static" />
        </article>
      </div>
    </div>
  );
}
