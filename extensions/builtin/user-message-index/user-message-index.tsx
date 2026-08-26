"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuiState } from "@assistant-ui/react";

import { MarkdownTextContent } from "@/components/assistant-ui/markdown-text";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

import { shouldShowUserMessageIndex } from "./user-message-index-layout";

interface UserMessageIndexProps {
  threadId?: string;
}

interface UserMessageSummary {
  id: string;
  preview: string;
  responsePreview: string;
}

const PREVIEW_LENGTH = 280;
const BASE_MARKER_WIDTH = 7;
const MARKER_WIDTHS = [29, 21, 15, 11] as const;

function getMarkerWidth(index: number, highlightedIndex: number | undefined): number {
  if (highlightedIndex === undefined) return BASE_MARKER_WIDTH;
  return MARKER_WIDTHS[Math.abs(index - highlightedIndex)] ?? BASE_MARKER_WIDTH;
}

function getTextPreview(
  content: readonly { type: string; text?: string }[],
  length = PREVIEW_LENGTH,
): string {
  const text = content
    .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
    .join("\n\n")
    .trim();

  return text.length > length ? text.slice(0, length).trimEnd() : text;
}

function MarkdownIndexPreview({
  text,
  lines,
  className,
}: Readonly<{
  text: string;
  lines: 1 | 2;
  className?: string;
}>) {
  return (
    <div
      inert
      className={cn(
        "min-w-0 max-w-full text-start leading-5",
        "[&>.aui-md]:overflow-hidden [&>.aui-md>*]:my-0 [&>.aui-md>*]:text-[inherit] [&>.aui-md>*]:leading-[inherit]",
        "[&_.aui-code-header-root]:hidden [&_.aui-md-pre]:rounded-md [&_.aui-md-pre]:border-t [&_.aui-md-pre]:p-1",
        lines === 1 ? "[&>.aui-md]:line-clamp-1" : "[&>.aui-md]:line-clamp-2",
        className,
      )}
    >
      <MarkdownTextContent text={text} smooth={false} />
    </div>
  );
}

function getMessageElement(root: HTMLElement, messageId: string): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-message-id]")).find(
    (element) => element.dataset.messageId === messageId,
  );
}

function getScrollViewport(element: HTMLElement, threadRoot: HTMLElement): HTMLElement | undefined {
  let current = element.parentElement;

  while (current && current !== threadRoot) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return current;
    current = current.parentElement;
  }

  return undefined;
}

export function UserMessageIndex({ threadId }: UserMessageIndexProps) {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();
  const messages = useAuiState((state) => state.thread.messages);
  const navRef = useRef<HTMLElement>(null);
  const [activeMessageId, setActiveMessageId] = useState<string>();
  const [hoveredMarkerIndex, setHoveredMarkerIndex] = useState<number>();
  const [focusedMarkerIndex, setFocusedMarkerIndex] = useState<number>();
  const [indexVisible, setIndexVisible] = useState(false);
  const highlightedMarkerIndex = hoveredMarkerIndex ?? focusedMarkerIndex;

  const userMessages = useMemo<readonly UserMessageSummary[]>(() => {
    const summaries: UserMessageSummary[] = [];

    for (const message of messages) {
      if (message.role === "user") {
        summaries.push({
          id: message.id,
          preview: getTextPreview(message.content),
          responsePreview: "",
        });
        continue;
      }

      if (message.role !== "assistant") continue;
      const currentSummary = summaries.at(-1);
      if (!currentSummary || currentSummary.responsePreview) continue;
      currentSummary.responsePreview = getTextPreview(message.content);
    }

    return summaries;
  }, [messages]);
  const hasUserMessages = userMessages.length > 0;

  useEffect(() => {
    if (!hasUserMessages) return;

    const nav = navRef.current;
    const threadRoot = nav?.closest<HTMLElement>('[data-workbench-surface="thread"]');
    const composerDock = threadRoot?.querySelector<HTMLElement>("[data-workbench-composer-dock]");
    if (!nav || !threadRoot || !composerDock) return;

    const updateVisibility = () => {
      const threadBounds = threadRoot.getBoundingClientRect();
      const composerBounds = composerDock.getBoundingClientRect();
      const nextVisible = shouldShowUserMessageIndex({
        composerStart: composerBounds.left,
        threadStart: threadBounds.left,
      });
      setIndexVisible((current) => (current === nextVisible ? current : nextVisible));
    };

    const observer = new ResizeObserver(updateVisibility);
    observer.observe(threadRoot);
    observer.observe(composerDock);
    updateVisibility();

    return () => observer.disconnect();
  }, [hasUserMessages, threadId]);

  useEffect(() => {
    const nav = navRef.current;
    const threadRoot = nav?.closest<HTMLElement>('[data-workbench-surface="thread"]');
    const firstMessage =
      threadRoot && userMessages[0] ? getMessageElement(threadRoot, userMessages[0].id) : undefined;
    const viewport =
      firstMessage && threadRoot ? getScrollViewport(firstMessage, threadRoot) : undefined;

    if (!threadRoot || !viewport || userMessages.length === 0) {
      setActiveMessageId(undefined);
      return;
    }

    let frame: number | undefined;
    const updateActiveMessage = () => {
      frame = undefined;
      const activationLine =
        viewport.getBoundingClientRect().top + Math.min(96, viewport.clientHeight / 4);
      let nextActiveId = userMessages[0]?.id;

      for (const message of userMessages) {
        const element = getMessageElement(threadRoot, message.id);
        if (element && element.getBoundingClientRect().top <= activationLine) {
          nextActiveId = message.id;
        }
      }

      setActiveMessageId((current) => (current === nextActiveId ? current : nextActiveId));
    };
    const scheduleUpdate = () => {
      if (frame !== undefined) return;
      frame = window.requestAnimationFrame(updateActiveMessage);
    };

    viewport.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    scheduleUpdate();

    return () => {
      viewport.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [threadId, userMessages]);

  const jumpToMessage = useCallback(
    (messageId: string) => {
      const nav = navRef.current;
      const threadRoot = nav?.closest<HTMLElement>('[data-workbench-surface="thread"]');
      const message = threadRoot ? getMessageElement(threadRoot, messageId) : undefined;
      const viewport = message && threadRoot ? getScrollViewport(message, threadRoot) : undefined;
      if (!message || !viewport) return;

      const viewportRect = viewport.getBoundingClientRect();
      const messageRect = message.getBoundingClientRect();
      const top = viewport.scrollTop + messageRect.top - viewportRect.top - 16;
      setActiveMessageId(messageId);
      viewport.scrollTo({
        top: Math.max(0, top),
        behavior: reduceMotion ? "auto" : "smooth",
      });
    },
    [reduceMotion],
  );

  if (!hasUserMessages) return null;

  return (
    <TooltipProvider delay={140}>
      <nav
        ref={navRef}
        aria-label={t("extensions.userMessageIndex.navigationLabel")}
        data-state={indexVisible ? "visible" : "hidden"}
        data-workbench-user-message-index=""
        className={cn(
          "absolute inset-y-0 left-0 z-10 h-full w-12",
          indexVisible ? "block" : "hidden",
        )}
        onPointerLeave={() => setHoveredMarkerIndex(undefined)}
      >
        <ol className="flex h-full w-full flex-col overflow-y-auto py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {userMessages.map((message, index) => {
            const isActive = activeMessageId ? activeMessageId === message.id : index === 0;
            const label = t("extensions.userMessageIndex.jumpTo", { index: index + 1 });

            return (
              <li
                key={message.id}
                className="h-[var(--control-hit-compact)] w-full shrink-0 first:mt-auto last:mb-auto"
              >
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={label}
                        aria-current={isActive ? "location" : undefined}
                        className="group/marker flex h-full w-full items-center pl-2.5 outline-none"
                        onClick={() => jumpToMessage(message.id)}
                        onPointerEnter={() => setHoveredMarkerIndex(index)}
                        onPointerLeave={() =>
                          setHoveredMarkerIndex((current) =>
                            current === index ? undefined : current,
                          )
                        }
                        onFocus={() => setFocusedMarkerIndex(index)}
                        onBlur={() =>
                          setFocusedMarkerIndex((current) =>
                            current === index ? undefined : current,
                          )
                        }
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "block h-0.5 origin-left rounded-full transition-[width,background-color] duration-100 ease-out",
                            highlightedMarkerIndex === index || isActive
                              ? "bg-foreground"
                              : "bg-muted-foreground/35",
                          )}
                          style={{ width: getMarkerWidth(index, highlightedMarkerIndex) }}
                        />
                      </button>
                    }
                  />
                  <TooltipContent
                    side="right"
                    align="center"
                    sideOffset={8}
                    data-workbench-glass-surface=""
                    className="max-w-[calc(100vw-5rem)] w-80 flex-col items-start gap-1 rounded-xl border border-border/70 bg-popover px-3.5 py-3 text-sm text-popover-foreground shadow-xl md:w-96 [&>div[aria-hidden=true]]:hidden"
                  >
                    <span className="sr-only">{label}</span>
                    <MarkdownIndexPreview
                      text={message.preview || t("extensions.userMessageIndex.nonTextPreview")}
                      lines={1}
                      className="font-medium"
                    />
                    {message.responsePreview ? (
                      <MarkdownIndexPreview
                        text={message.responsePreview}
                        lines={2}
                        className="text-muted-foreground"
                      />
                    ) : null}
                  </TooltipContent>
                </Tooltip>
              </li>
            );
          })}
        </ol>
      </nav>
    </TooltipProvider>
  );
}
