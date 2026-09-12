"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Button } from "../ui/button";
import { useI18n } from "../i18n";
import { useDisclosureScrollLock } from "../elements/use-disclosure-scroll-lock";

export function UserMessageTextBubble({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [previewHeight, setPreviewHeight] = useState<number>();
  const [rootRef, , prepareTransition] = useDisclosureScrollLock(setExpanded);
  const contentRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const folded = previewHeight !== undefined && !expanded;

  useLayoutEffect(() => {
    const content = contentRef.current;
    const line = lineRef.current;
    if (!content || !line) return;
    const hidden = new Map<HTMLElement, boolean>();
    const restoreFocus = () => {
      for (const [element, inert] of hidden) element.inert = inert;
      hidden.clear();
    };
    const measure = () => {
      const lineHeight = line.getBoundingClientRect().height;
      if (!lineHeight || !content.clientWidth) return;
      const height = content.scrollHeight;
      let limit: number | undefined;
      if (height > lineHeight * 20 + 1) {
        limit = lineHeight * 19;
        const top = content.getBoundingClientRect().top;
        for (const block of content.querySelectorAll<HTMLElement>(".aui-codex-code-body, pre")) {
          // A code block has its own scroll viewport; its inner pre can extend beyond it.
          if (block.tagName === "PRE" && block.closest(".aui-codex-code-body")) continue;
          const header = block.previousElementSibling;
          const start = header?.matches(".aui-codex-code-header") ? header : block;
          const bottom = block.getBoundingClientRect().bottom - top;
          if (start.getBoundingClientRect().top - top < limit && bottom > limit) limit = bottom;
        }
      }
      setPreviewHeight(limit);
      restoreFocus();
      if (!expanded && limit !== undefined) {
        const bottom = content.getBoundingClientRect().top + limit;
        for (const element of content.querySelectorAll<HTMLElement>(
          "a[href], button, input, select, textarea, [tabindex], [contenteditable=true], summary",
        )) {
          if (element.getBoundingClientRect().bottom > bottom + 1) {
            hidden.set(element, element.inert);
            element.inert = true;
          }
        }
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(line);
    const mutations = new MutationObserver(measure);
    mutations.observe(content, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
      restoreFocus();
    };
  }, [children, expanded]);

  return (
    <div
      ref={rootRef}
      data-slot="user-message-bubble"
      className="w-fit max-w-full min-w-0 self-end rounded-[var(--radius-xl)] bg-aui-user-message px-4 py-2.5 text-start text-base leading-6 text-foreground whitespace-pre-wrap dark:ring-1 dark:ring-inset dark:ring-border [overflow-wrap:anywhere]"
    >
      <div
        id={id}
        className="overflow-hidden"
        style={folded ? { maxHeight: previewHeight } : undefined}
      >
        <div ref={contentRef} className="relative flow-root">
          <span
            ref={lineRef}
            aria-hidden="true"
            className="pointer-events-none absolute h-[1lh] w-0"
          />
          {children}
        </div>
      </div>
      {folded && (
        <div aria-hidden="true" className="text-muted-foreground">
          …
        </div>
      )}
      {previewHeight !== undefined && (
        <Button
          ref={buttonRef}
          type="button"
          variant="ghost"
          size="sm"
          data-frame="none"
          data-selection="none"
          className="text-muted-foreground hover:text-foreground"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => {
            prepareTransition(
              !expanded,
              0,
              expanded ? (buttonRef.current ?? undefined) : undefined,
            );
            setExpanded(!expanded);
          }}
        >
          {t(expanded ? "chatContent.userMessage.showLess" : "chatContent.userMessage.showMore")}
          {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </Button>
      )}
    </div>
  );
}
