"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversationNodes } from "@workbench/agent-runtime-client";

import { MarkdownTextContent } from "../../../chat/markdown/lazy-markdown-text";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../../ui/tooltip";
import { useI18n } from "../../../i18n";
import { useReducedMotion } from "../../../hooks/use-reduced-motion";
import { cn } from "../../../utils";
import { isWorkbenchLayoutMoving } from "../../../layout";

import {
  getMessageElements,
  isMessageInViewport,
  shouldShowUserMessageIndex,
} from "./user-message-index-layout";

interface UserMessageIndexProps {
  threadId?: string;
}

interface UserMessageSummary {
  id: string;
  preview: string;
  responsePreview: string;
}

const PREVIEW_LENGTH = 280;

function getTextPreview(
  content: readonly { kind: string; text?: string }[],
  length = PREVIEW_LENGTH,
): string {
  const text = content
    .flatMap((part) => (part.kind === "text" && typeof part.text === "string" ? [part.text] : []))
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
        "[&>.aui-streamdown>*]:my-0! [&>.aui-streamdown>*]:text-[inherit]! [&>.aui-streamdown>*]:leading-[inherit]!",
        "[&_.aui-codex-code-header]:hidden!",
        lines === 1
          ? "[&>*]:line-clamp-1 [&_pre]:line-clamp-1"
          : "[&>*]:line-clamp-2 [&_pre]:line-clamp-2",
        className,
      )}
    >
      <MarkdownTextContent text={text} smooth={false} inheritLineHeight resetParagraphMargins />
    </div>
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
  const nodes = useConversationNodes();
  const navRef = useRef<HTMLElement>(null);
  const [activeMessageId, setActiveMessageId] = useState<string>();
  const [visibleMessageIds, setVisibleMessageIds] = useState<readonly string[]>([]);
  const [indexVisible, setIndexVisible] = useState(false);

  const userMessages = useMemo<readonly UserMessageSummary[]>(() => {
    const summaries: UserMessageSummary[] = [];

    for (const node of nodes) {
      if (node.kind === "user") {
        summaries.push({
          id: node.key,
          preview: getTextPreview(node.blocks),
          responsePreview: "",
        });
        continue;
      }

      if (node.kind !== "assistant") continue;
      const currentSummary = summaries.at(-1);
      if (!currentSummary || currentSummary.responsePreview) continue;
      currentSummary.responsePreview = getTextPreview(node.blocks);
    }

    return summaries;
  }, [nodes]);
  const hasUserMessages = userMessages.length > 0;

  useEffect(() => {
    if (!hasUserMessages) return;

    const nav = navRef.current;
    const threadRoot = nav?.closest<HTMLElement>('[data-workbench-surface="thread"]');
    const composerDock = threadRoot?.querySelector<HTMLElement>("[data-workbench-composer-dock]");
    const shell = threadRoot?.closest<HTMLElement>("[data-workbench-shell]");
    if (!nav || !threadRoot || !composerDock) return;

    let visible = nav.dataset.state === "visible";
    const updateVisibility = () => {
      const layoutMoving = isWorkbenchLayoutMoving(shell);
      // Revealing the index installs message measurements. Defer that work until
      // panel and gutter motion settle, while keeping an existing index usable.
      if (layoutMoving && !visible) return;
      const threadBounds = threadRoot.getBoundingClientRect();
      const composerBounds = composerDock.getBoundingClientRect();
      const nextVisible = shouldShowUserMessageIndex({
        composerStart: composerBounds.left,
        threadStart: threadBounds.left,
        layoutAllowsIndex: shell?.dataset.conversationIndex !== "hidden",
        layoutMoving,
        previouslyVisible: visible,
      });
      visible = nextVisible;
      setIndexVisible((current) => (current === nextVisible ? current : nextVisible));
    };

    const observer = new ResizeObserver(updateVisibility);
    observer.observe(threadRoot);
    observer.observe(composerDock);
    let layoutObserver: MutationObserver | undefined;
    if (shell) {
      layoutObserver = new MutationObserver(updateVisibility);
      layoutObserver.observe(shell, {
        attributes: true,
        attributeFilter: [
          "data-conversation-index",
          "data-layout-animating",
          "data-resizing",
          "data-window-resizing",
        ],
      });
    }
    updateVisibility();

    return () => {
      observer.disconnect();
      layoutObserver?.disconnect();
    };
  }, [hasUserMessages, threadId]);

  useEffect(() => {
    if (!indexVisible) return;

    const nav = navRef.current;
    const threadRoot = nav?.closest<HTMLElement>('[data-workbench-surface="thread"]');
    // Message seats keep their identity until the conversation nodes change. Resolve them once
    // instead of scanning the entire conversation for every marker on every scroll/resize frame.
    const messageElements = threadRoot ? getMessageElements(threadRoot) : undefined;
    const firstMessage = userMessages[0] ? messageElements?.get(userMessages[0].id) : undefined;
    const viewport =
      firstMessage && threadRoot ? getScrollViewport(firstMessage, threadRoot) : undefined;

    if (!threadRoot || !viewport || userMessages.length === 0) {
      setActiveMessageId(undefined);
      setVisibleMessageIds((current) => (current.length ? [] : current));
      return;
    }

    let frame: number | undefined;
    const updateActiveMessage = () => {
      frame = undefined;
      const viewportBounds = viewport.getBoundingClientRect();
      const activationLine = viewportBounds.top + Math.min(96, viewport.clientHeight / 4);
      let nextActiveId = userMessages[0]?.id;
      const nextVisibleMessageIds: string[] = [];

      for (const message of userMessages) {
        const element = messageElements?.get(message.id);
        if (!element) continue;
        const messageBounds = element.getBoundingClientRect();
        if (isMessageInViewport(messageBounds, viewportBounds)) {
          nextVisibleMessageIds.push(message.id);
        }
        if (messageBounds.top <= activationLine) {
          nextActiveId = message.id;
        }
      }

      setActiveMessageId((current) => (current === nextActiveId ? current : nextActiveId));
      setVisibleMessageIds((current) =>
        current.length === nextVisibleMessageIds.length &&
        current.every((id, index) => id === nextVisibleMessageIds[index])
          ? current
          : nextVisibleMessageIds,
      );
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
  }, [indexVisible, threadId, userMessages]);

  const jumpToMessage = useCallback(
    (messageId: string) => {
      const nav = navRef.current;
      const threadRoot = nav?.closest<HTMLElement>('[data-workbench-surface="thread"]');
      const message = threadRoot ? getMessageElements(threadRoot).get(messageId) : undefined;
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
          indexVisible ? "block in-data-[conversation-index=hidden]:hidden" : "hidden",
        )}
      >
        <ol className="flex h-full w-full flex-col overflow-y-auto py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {userMessages.map((message, index) => {
            const isActive = activeMessageId ? activeMessageId === message.id : index === 0;
            const isVisible = visibleMessageIds.includes(message.id);
            const label = t("extensions.userMessageIndex.jumpTo", { index: index + 1 });

            return (
              <li key={message.id} className="w-full shrink-0 first:mt-auto last:mb-auto">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={label}
                        aria-current={isActive ? "location" : undefined}
                        className="group/marker flex w-full items-center py-0.75 pl-2.5 outline-none"
                        onClick={() => jumpToMessage(message.id)}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "block h-0.5 w-[29px] origin-left rounded-full transition-[transform,background-color] duration-50 ease-out group-hover/marker:bg-foreground group-focus-visible/marker:bg-foreground motion-reduce:transition-none",
                            isVisible ? "bg-foreground" : "bg-muted-foreground/35",
                          )}
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
