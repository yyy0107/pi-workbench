"use client";

import { memo, useLayoutEffect, useState } from "react";
import type { CodeTheme } from "@workbench/appearance";
import { useDisclosureScrollLock } from "@workbench/ui/disclosure";
import { cn } from "@workbench/ui/utils";
import { CodexCodeHeader } from "./codex-code-header";
import { MarkdownCodeBlock } from "./markdown-code-block";

export interface WorkbenchCodeBlockProps {
  readonly code: string;
  readonly language: string;
  readonly codeTheme?: CodeTheme;
  readonly className?: string;
}

/** Shared code surface used by both parsed Markdown fences and literal editor contents. */
export function WorkbenchCodeBlockBody({ code, language, codeTheme }: WorkbenchCodeBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [bodyRef, , prepareDisclosureTransition] = useDisclosureScrollLock(setExpanded);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || expanded) return;

    const measure = () => {
      const viewport = body.querySelector<HTMLElement>('[data-markdown="code-block-body"]');
      setOverflowing(Boolean(viewport && viewport.scrollHeight > viewport.clientHeight + 1));
    };
    const resizeObserver = new ResizeObserver(measure);
    const observeContent = () => {
      resizeObserver.disconnect();
      body.querySelectorAll('[data-markdown="code-block-body"], pre').forEach((element) => {
        resizeObserver.observe(element);
      });
      measure();
    };
    // Highlighting can replace the scroll viewport after the initial render.
    const mutationObserver = new MutationObserver(observeContent);
    mutationObserver.observe(body, { childList: true, subtree: true, characterData: true });
    observeContent();
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [bodyRef, code, expanded]);

  return (
    <>
      <CodexCodeHeader
        code={code}
        language={language}
        expanded={expanded}
        onToggleExpanded={
          expanded || overflowing
            ? () => {
                const duration = bodyRef.current
                  ? Number.parseFloat(
                      getComputedStyle(bodyRef.current).getPropertyValue(
                        "--layout-motion-duration",
                      ),
                    )
                  : 0;
                prepareDisclosureTransition(!expanded, duration || 0);
                setExpanded(!expanded);
              }
            : undefined
        }
      />
      <div ref={bodyRef} className="aui-codex-code-body" data-expanded={expanded}>
        <MarkdownCodeBlock code={code} language={language} codeTheme={codeTheme} />
      </div>
    </>
  );
}

/** Render source verbatim without Markdown normalization, math parsing, or diagram rendering. */
export const WorkbenchCodeBlock = memo(function WorkbenchCodeBlock({
  className,
  language,
  ...props
}: WorkbenchCodeBlockProps) {
  return (
    <div
      className={cn(
        "aui-workbench-code-block aui-markdown space-y-0 [&>*:first-child]:mt-0! [&>*:last-child]:mb-0!",
        className,
      )}
    >
      <WorkbenchCodeBlockBody
        {...props}
        language={language.trim().replace(/\s+/g, "-") || "text"}
      />
    </div>
  );
});
