"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { MarkdownTextContent } from "@/components/assistant-ui/markdown-text";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
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
  const [copied, setCopied] = useState(false);
  const feedbackTimeout = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (feedbackTimeout.current !== undefined) {
        window.clearTimeout(feedbackTimeout.current);
      }
    },
    [],
  );

  const copyMarkdown = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(content).then(
      () => {
        setCopied(true);
        if (feedbackTimeout.current !== undefined) {
          window.clearTimeout(feedbackTimeout.current);
        }
        feedbackTimeout.current = window.setTimeout(() => {
          feedbackTimeout.current = undefined;
          setCopied(false);
        }, COPY_FEEDBACK_DURATION_MS);
      },
      () => {},
    );
  };

  return (
    <div className="relative h-full bg-transparent">
      <TooltipIconButton
        tooltip={
          copied
            ? t("extensions.workspaceFile.markdownCopied")
            : t("extensions.workspaceFile.copyMarkdown")
        }
        aria-label={
          copied
            ? t("extensions.workspaceFile.markdownCopied")
            : t("extensions.workspaceFile.copyMarkdown")
        }
        className="text-muted-foreground hover:text-foreground absolute top-3 end-3 z-10 size-7 bg-transparent hover:bg-transparent dark:hover:bg-transparent"
        onClick={copyMarkdown}
      >
        {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
      </TooltipIconButton>
      <div role="document" aria-label={ariaLabel} className="h-full overflow-auto">
        <article className="mx-auto w-full max-w-4xl px-8 py-7 pe-14 text-sm leading-7 break-words">
          <MarkdownTextContent text={content} defer={false} mode="static" />
        </article>
      </div>
    </div>
  );
}
