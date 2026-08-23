"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useRef, useState } from "react";

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
    <div className="relative h-full bg-background">
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
        <article className="mx-auto w-full max-w-4xl px-8 py-7 pe-14 text-sm leading-7 break-words [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:my-4 [&_blockquote]:border-s-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:ps-4 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_h1]:mt-8 [&_h1]:mb-4 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1:first-child]:mt-0 [&_h2]:mt-7 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:pb-2 [&_h2]:text-2xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-xl [&_h3]:font-semibold [&_hr]:my-6 [&_hr]:border-border [&_img]:max-w-full [&_li]:my-1 [&_ol]:my-4 [&_ol]:ms-6 [&_ol]:list-decimal [&_p]:my-4 [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:text-xs [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-3 [&_td]:py-1.5 [&_th]:border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-start [&_ul]:my-4 [&_ul]:ms-6 [&_ul]:list-disc">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
