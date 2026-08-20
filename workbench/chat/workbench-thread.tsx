"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ThreadPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { ArrowDownIcon } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { DaySeparator } from "@/components/elements/conversation-separator";
import { MessagePair } from "@/components/elements/message-pair";
import { TypingIndicator } from "@/components/elements/typing-indicator";
import { useI18n } from "@/i18n";
import { formatCompactDuration } from "@/lib/format-duration";
import { SlotHost } from "@/platform/extensions";
import { parsePiConversationEvent } from "@/runtime/pi/client/messages/conversation-events";

import { WorkbenchComposer } from "./workbench-composer";
import { WorkbenchEmpty } from "./workbench-empty";
import { isLastConversationPair } from "./workbench-message-rows";
import {
  WorkbenchAssistantMessage,
  WorkbenchEditComposer,
  WorkbenchSystemMessage,
  WorkbenchUserMessage,
} from "./workbench-message";
import { currentRunStartedAt } from "./workbench-thread-timing";

export interface WorkbenchThreadProps {
  threadId?: string;
}

interface MessageRow {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: number;
}

function localDayKey(timestamp: number): string | undefined {
  // Legacy Pi entries can lack timestamps and use tiny positional fallbacks.
  // Do not turn those placeholders into a misleading January 1970 divider.
  if (timestamp < Date.UTC(2000, 0, 1)) return undefined;
  const value = new Date(timestamp);
  if (!Number.isFinite(value.getTime())) return undefined;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const messageComponents = {
  UserMessage: WorkbenchUserMessage,
  AssistantMessage: WorkbenchAssistantMessage,
  SystemMessage: WorkbenchSystemMessage,
  EditComposer: WorkbenchEditComposer,
};

function useThreadMessageRows(): readonly MessageRow[] {
  const previousRows = useRef<readonly MessageRow[]>([]);

  return useAuiState((state) => {
    const messages = state.thread.messages;
    const previous = previousRows.current;

    if (
      previous.length === messages.length &&
      previous.every(
        (row, index) =>
          row.id === messages[index]?.id &&
          row.role === messages[index]?.role &&
          row.createdAt === messages[index]?.createdAt.getTime(),
      )
    ) {
      return previous;
    }

    const next = messages.map(({ id, role, createdAt }) => ({
      id,
      role,
      createdAt: createdAt.getTime(),
    }));
    previousRows.current = next;
    return next;
  });
}

function PiWorkingStatus() {
  const { t } = useI18n();
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const isEmpty = useAuiState((state) => state.thread.isEmpty);
  const runStartedAt = useAuiState((state) => currentRunStartedAt(state.thread.messages));
  const fallbackStartedAt = useRef<number | undefined>(undefined);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isRunning) {
      fallbackStartedAt.current = undefined;
      setElapsedSeconds(0);
      return;
    }

    const startedAt = runStartedAt ?? fallbackStartedAt.current ?? Date.now();
    fallbackStartedAt.current = startedAt;
    const updateElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)));
    };

    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(interval);
  }, [isRunning, runStartedAt]);

  if (isEmpty || !isRunning) return null;

  return (
    <div
      data-slot="pi-working"
      role="status"
      aria-live="polite"
      aria-label={t("workbench.chat.working")}
      className="text-foreground/70 mx-auto mb-4 flex h-[26px] w-full max-w-[var(--thread-max-width)] shrink-0 items-center gap-2 px-2 text-sm font-medium [overflow-anchor:auto]"
    >
      <ThinkingOrb
        state="connecting"
        size={20}
        speed={3.0}
        role="presentation"
        aria-hidden="true"
      />
      <span
        data-slot="pi-working-label"
        aria-hidden="true"
        className="shimmer [--shimmer-color:white] [--shimmer-repeat-delay:900] [--shimmer-speed:180] [--shimmer-spread:52px] motion-reduce:animate-none"
      >
        {t("workbench.chat.workingElapsed", {
          duration: formatCompactDuration(elapsedSeconds * 1_000, { zeroValue: "0s" }),
        })}
      </span>
    </div>
  );
}

function WorkbenchMessages() {
  const { date } = useI18n();
  const messages = useThreadMessageRows();
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const items: React.ReactNode[] = [];
  let previousDay: string | undefined;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;

    const day = localDayKey(message.createdAt);
    if (day && day !== previousDay) {
      items.push(
        <DaySeparator
          key={`day:${day}:${message.id}`}
          dateTime={day}
          label={date(message.createdAt, {
            year: "numeric",
            month: "short",
            day: "numeric",
            weekday: "short",
          })}
          aria-label={date(message.createdAt, {
            year: "numeric",
            month: "long",
            day: "numeric",
            weekday: "long",
          })}
          className="[overflow-anchor:none]"
        />,
      );
      previousDay = day;
    }

    if (message.role === "system") {
      items.push(
        <div key={message.id} className="[overflow-anchor:none]">
          <ThreadPrimitive.MessageByIndex index={index} components={messageComponents} />
        </div>,
      );
      continue;
    }

    const nextMessage = messages[index + 1];
    const assistantIndex =
      message.role === "user" &&
      nextMessage?.role === "assistant" &&
      localDayKey(nextMessage.createdAt) === day
        ? index + 1
        : undefined;
    const pairMessageIndex = assistantIndex ?? index;
    const isLastPair = isLastConversationPair(messages, pairMessageIndex);

    items.push(
      <MessagePair
        key={assistantIndex === undefined ? message.id : `${message.id}:${nextMessage.id}`}
        variant="flat"
        className={`max-w-none gap-4 px-2 [contain-intrinsic-size:auto_12rem] [content-visibility:auto] ${isLastPair ? "[overflow-anchor:auto]" : "[overflow-anchor:none]"}`}
        userMessage={
          message.role === "user" ? (
            <ThreadPrimitive.MessageByIndex index={index} components={messageComponents} />
          ) : undefined
        }
        assistantMessage={
          message.role === "assistant" || assistantIndex !== undefined ? (
            <ThreadPrimitive.MessageByIndex
              index={assistantIndex ?? index}
              components={messageComponents}
            />
          ) : undefined
        }
      />,
    );

    if (assistantIndex !== undefined) index = assistantIndex;
  }

  if (items.length === 0) return null;

  return (
    <div
      data-slot="conversation-flow"
      className={`mx-auto flex w-full max-w-[var(--thread-max-width)] shrink-0 flex-col gap-4 ${isRunning ? "pb-1 [overflow-anchor:none]" : "pb-4 [overflow-anchor:auto]"}`}
    >
      {items}
    </div>
  );
}

/**
 * Synchronizes a route id only after the thread list proves that it exists.
 * Unknown or stale ids intentionally leave the current thread mounted.
 */
export function ThreadRouteSync({ threadId }: { threadId?: string }) {
  const aui = useAui();
  const syncedRouteId = useRef<string | null>(null);
  const isLoading = useAuiState((state) => state.threads.isLoading);
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const threadIds = useAuiState((state) => state.threads.threadIds);
  const threadItems = useAuiState((state) => state.threads.threadItems);

  useEffect(() => {
    const routeId = threadId ?? "";
    if (isLoading || syncedRouteId.current === routeId) return;

    if (!threadId) {
      syncedRouteId.current = routeId;

      try {
        aui.threads.switchToNewThread();
      } catch {
        // The thread list can change between the state read and route update.
      }
      return;
    }

    const item = threadItems.find(
      (candidate) =>
        candidate.id === threadId ||
        candidate.remoteId === threadId ||
        candidate.externalId === threadId,
    );
    const resolvedId = item?.id ?? (threadIds.includes(threadId) ? threadId : undefined);

    if (!resolvedId) return;

    syncedRouteId.current = routeId;
    if (resolvedId === mainThreadId) return;

    try {
      aui.threads.switchToThread(resolvedId);
    } catch {
      // A runtime can invalidate a thread between the state read and switch.
      // Keeping the current thread is the safe route-level fallback.
    }
  }, [aui, isLoading, mainThreadId, threadId, threadIds, threadItems]);

  return null;
}

export function WorkbenchThread({ threadId }: WorkbenchThreadProps) {
  const { t } = useI18n();
  const activeThreadId = useAuiState((state) => state.threads.mainThreadId);
  const isEmpty = useAuiState((state) => state.thread.isEmpty);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const queueLength = useAuiState((state) => state.thread.composer.queue.length);
  const trailingModelChangeRevision = useAuiState((state) => {
    const message = state.thread.messages.at(-1);
    if (message?.role !== "system") return undefined;
    const event = parsePiConversationEvent(message.metadata.custom.piConversationEvent);
    if (event?.kind !== "model-change") return undefined;

    return [
      message.id,
      event.previousProvider ?? "",
      event.previousModel ?? "",
      event.provider ?? "",
      event.model,
    ].join("\u0000");
  });
  const viewportRef = useRef<HTMLDivElement>(null);
  const wasAtBottom = useRef(true);
  const previousQueueLength = useRef(queueLength);
  const previousIsRunning = useRef(isRunning);
  const completionFollowActive = useRef(false);
  const completionFollowCleanup = useRef<(() => void) | null>(null);
  const modelChangeFollowCleanup = useRef<(() => void) | null>(null);
  const slotContext = { threadId: threadId ?? activeThreadId };

  const stopCompletionFollow = useCallback(() => {
    completionFollowCleanup.current?.();
    completionFollowCleanup.current = null;
    completionFollowActive.current = false;
  }, []);

  const stopModelChangeFollow = useCallback(() => {
    modelChangeFollowCleanup.current?.();
    modelChangeFollowCleanup.current = null;
  }, []);

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "instant" });
  }, []);

  useLayoutEffect(() => {
    if (trailingModelChangeRevision === undefined) return;

    stopModelChangeFollow();
    const viewport = viewportRef.current;
    if (!viewport) return;

    const conversationFlow = viewport.querySelector<HTMLElement>('[data-slot="conversation-flow"]');
    let frame: number | null = null;
    let timeout: number | null = null;
    let stopped = false;

    const keepAtBottom = () => {
      if (stopped) return;
      scrollToBottom();
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        scrollToBottom();
      });
    };
    const observer = new ResizeObserver(keepAtBottom);
    const stop = () => {
      if (stopped) return;
      stopped = true;
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (timeout !== null) window.clearTimeout(timeout);
      if (modelChangeFollowCleanup.current === stop) {
        modelChangeFollowCleanup.current = null;
      }
    };

    if (conversationFlow) observer.observe(conversationFlow);
    modelChangeFollowCleanup.current = stop;
    timeout = window.setTimeout(stop, 3_000);
    keepAtBottom();

    return stop;
  }, [scrollToBottom, stopModelChangeFollow, trailingModelChangeRevision]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateBottomState = () => {
      if (completionFollowActive.current) return;
      const distanceFromBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      wasAtBottom.current = Math.abs(distanceFromBottom) <= 1;
    };
    const cancelScrollFollow = () => {
      stopCompletionFollow();
      stopModelChangeFollow();
    };

    updateBottomState();
    viewport.addEventListener("scroll", updateBottomState, { passive: true });
    viewport.addEventListener("pointerdown", cancelScrollFollow, { passive: true });
    viewport.addEventListener("wheel", cancelScrollFollow, { passive: true });

    return () => {
      viewport.removeEventListener("scroll", updateBottomState);
      viewport.removeEventListener("pointerdown", cancelScrollFollow);
      viewport.removeEventListener("wheel", cancelScrollFollow);
      stopCompletionFollow();
      stopModelChangeFollow();
    };
  }, [stopCompletionFollow, stopModelChangeFollow]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const queueChanged = previousQueueLength.current !== queueLength;
    const runStarted = !previousIsRunning.current && isRunning;
    const runCompleted = previousIsRunning.current && !isRunning;

    previousQueueLength.current = queueLength;
    previousIsRunning.current = isRunning;

    // The viewport schedules a bottom scroll on run start. Preserve that intent while the
    // smooth scroll is still in flight, then let real user scrolling update it again.
    if (runStarted) wasAtBottom.current = true;

    if (queueChanged && isRunning && wasAtBottom.current) {
      scrollToBottom();
    }

    if (!viewport || !runCompleted || !wasAtBottom.current) return;

    stopCompletionFollow();

    const conversationFlow = viewport.querySelector<HTMLElement>('[data-slot="conversation-flow"]');
    if (!conversationFlow) {
      scrollToBottom();
      return;
    }

    // Completed tool/reasoning panels collapse with a height transition. Follow the changing
    // content height until it settles instead of correcting only the first animation frame.
    let settleTimer: number | null = null;
    const observer = new ResizeObserver(() => keepAtBottom());
    const stop = () => {
      observer.disconnect();
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      if (completionFollowCleanup.current === stop) {
        completionFollowCleanup.current = null;
        completionFollowActive.current = false;
      }
    };
    const keepAtBottom = () => {
      scrollToBottom();
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(stop, 100);
    };

    completionFollowActive.current = true;
    completionFollowCleanup.current = stop;
    observer.observe(conversationFlow);
    keepAtBottom();

    return stop;
  }, [isRunning, queueLength, scrollToBottom, stopCompletionFollow]);

  return (
    <ThreadPrimitive.Root
      data-workbench-surface="thread"
      className="bg-background flex h-full min-h-0 min-w-0 text-base"
      style={
        {
          "--thread-max-width": "48rem",
        } as React.CSSProperties
      }
    >
      <ThreadRouteSync threadId={threadId} />
      <SlotHost
        name="thread.left"
        context={slotContext}
        className="flex h-full min-h-0 shrink-0 flex-col empty:hidden"
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <SlotHost
          name="thread.header"
          context={slotContext}
          className="flex shrink-0 items-center gap-2 border-b px-4 empty:hidden"
        />

        {/* Run start, thread switches, and the explicit button still scroll to the end. During a
            run, native scroll anchoring keeps Pi Working fixed across internal reflows. */}
        <ThreadPrimitive.Viewport
          ref={viewportRef}
          turnAnchor="bottom"
          autoScroll={false}
          className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto scroll-smooth px-4 pt-4"
        >
          <SlotHost
            name="thread.before"
            context={slotContext}
            className="mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-2 [overflow-anchor:none]"
          />

          <ThreadPrimitive.Empty>
            <WorkbenchEmpty>
              <WorkbenchComposer />
            </WorkbenchEmpty>
          </ThreadPrimitive.Empty>

          <WorkbenchMessages />

          <SlotHost
            name="thread.after"
            context={slotContext}
            className="mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-2 [overflow-anchor:none]"
          />

          <PiWorkingStatus />

          <ThreadPrimitive.ScrollToBottom
            render={
              <TooltipIconButton
                tooltip={t("workbench.chat.scrollLatest")}
                variant="outline"
                className="bg-background sticky bottom-44 z-10 mx-auto -mt-8 size-8 shrink-0 rounded-full shadow-sm disabled:invisible [overflow-anchor:none]"
              />
            }
          >
            {isRunning ? (
              <TypingIndicator
                label={t("workbench.chat.scrollLatest")}
                variant="bare"
                aria-hidden="true"
                className="scale-75"
              />
            ) : (
              <ArrowDownIcon className="size-4" />
            )}
          </ThreadPrimitive.ScrollToBottom>

          {!isEmpty ? (
            <ThreadPrimitive.ViewportFooter
              data-workbench-composer-dock=""
              className="sticky bottom-0 mx-auto mt-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-3 bg-transparent pt-2 pb-4 [overflow-anchor:none]"
            >
              <WorkbenchComposer />
            </ThreadPrimitive.ViewportFooter>
          ) : null}
        </ThreadPrimitive.Viewport>
      </div>

      <SlotHost
        name="thread.right"
        context={slotContext}
        className="flex h-full min-h-0 shrink-0 flex-col empty:hidden"
      />
    </ThreadPrimitive.Root>
  );
}
