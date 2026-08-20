"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ThreadPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { ArrowDownIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { ThinkingOrb } from "thinking-orbs";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { DaySeparator } from "@/components/elements/conversation-separator";
import { MessagePair } from "@/components/elements/message-pair";
import { TypingIndicator } from "@/components/elements/typing-indicator";
import { useI18n } from "@/i18n";
import { formatCompactDuration } from "@/lib/format-duration";
import { SlotHost } from "@/platform/extensions";
import { parsePiConversationEvent } from "@/runtime/pi/client/messages/conversation-events";
import {
  conversationThreadIdFromPathname,
  resolvePromotedThreadRouteId,
  shouldProjectNewThreadRoute,
} from "@/workbench/workspaces/new-thread-policy";

import { WorkbenchComposer } from "./workbench-composer";
import { WorkbenchEmpty } from "./workbench-empty";
import {
  conversationPairKey,
  isLastConversationPair,
  shouldShowWorkingStatus,
} from "./workbench-message-rows";
import {
  WorkbenchAssistantMessage,
  WorkbenchEditComposer,
  WorkbenchSystemMessage,
  WorkbenchUserMessage,
} from "./workbench-message";
import { currentRunStartedAt } from "./workbench-thread-timing";

interface MessageRow {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: number;
  status: string;
}

interface ThreadScrollPosition {
  scrollTop: number;
  atBottom: boolean;
}

const THREAD_SCROLL_STORAGE_KEY = "workbench.thread-scroll-positions.v1";
const MAX_SAVED_THREAD_SCROLL_POSITIONS = 50;
const BOTTOM_DISTANCE_THRESHOLD = 2;
const threadScrollPositions = new Map<string, ThreadScrollPosition>();
let threadScrollPositionsLoaded = false;
let threadScrollPersistenceFrame: number | null = null;

function loadThreadScrollPositions() {
  if (threadScrollPositionsLoaded || typeof window === "undefined") return;
  threadScrollPositionsLoaded = true;

  try {
    const stored = window.sessionStorage.getItem(THREAD_SCROLL_STORAGE_KEY);
    if (!stored) return;

    const entries: unknown = JSON.parse(stored);
    if (!Array.isArray(entries)) return;

    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [threadId, position] = entry;
      if (
        typeof threadId !== "string" ||
        !position ||
        typeof position !== "object" ||
        !("scrollTop" in position) ||
        !("atBottom" in position) ||
        typeof position.scrollTop !== "number" ||
        !Number.isFinite(position.scrollTop) ||
        typeof position.atBottom !== "boolean"
      ) {
        continue;
      }

      threadScrollPositions.set(threadId, {
        scrollTop: Math.max(0, position.scrollTop),
        atBottom: position.atBottom,
      });
    }
  } catch {
    // Scroll restoration is an enhancement; unavailable storage must not block chat rendering.
  }
}

function getThreadScrollPosition(threadId: string): ThreadScrollPosition | undefined {
  loadThreadScrollPositions();
  return threadScrollPositions.get(threadId);
}

function saveThreadScrollPosition(threadId: string, position: ThreadScrollPosition) {
  loadThreadScrollPositions();
  threadScrollPositions.delete(threadId);
  threadScrollPositions.set(threadId, position);

  while (threadScrollPositions.size > MAX_SAVED_THREAD_SCROLL_POSITIONS) {
    const oldestThreadId = threadScrollPositions.keys().next().value;
    if (oldestThreadId === undefined) break;
    threadScrollPositions.delete(oldestThreadId);
  }

  if (threadScrollPersistenceFrame !== null) return;
  threadScrollPersistenceFrame = window.requestAnimationFrame(() => {
    threadScrollPersistenceFrame = null;
    try {
      window.sessionStorage.setItem(
        THREAD_SCROLL_STORAGE_KEY,
        JSON.stringify(Array.from(threadScrollPositions.entries())),
      );
    } catch {
      // The in-memory cache still preserves positions while this page remains mounted.
    }
  });
}

function readViewportPosition(viewport: HTMLElement): ThreadScrollPosition {
  const distanceFromBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
  return {
    scrollTop: Math.max(0, viewport.scrollTop),
    atBottom:
      Math.abs(distanceFromBottom) <= BOTTOM_DISTANCE_THRESHOLD ||
      viewport.scrollHeight <= viewport.clientHeight,
  };
}

function observeViewportContent(viewport: HTMLElement, onChange: () => void): () => void {
  const observedElements = new Set<Element>();
  const resizeObserver = new ResizeObserver(onChange);
  const observeElements = () => {
    for (const element of [viewport, ...viewport.children]) {
      if (observedElements.has(element)) continue;
      observedElements.add(element);
      resizeObserver.observe(element);
    }
  };
  const mutationObserver = new MutationObserver(() => {
    observeElements();
    onChange();
  });

  observeElements();
  mutationObserver.observe(viewport, { childList: true, subtree: true });

  return () => {
    resizeObserver.disconnect();
    mutationObserver.disconnect();
  };
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
          row.createdAt === messages[index]?.createdAt.getTime() &&
          row.status === (messages[index]?.status?.type ?? "complete"),
      )
    ) {
      return previous;
    }

    const next = messages.map((message) => ({
      id: message.id,
      role: message.role,
      createdAt: message.createdAt.getTime(),
      status: message.status?.type ?? "complete",
    }));
    previousRows.current = next;
    return next;
  });
}

function PiWorkingStatus() {
  const { t } = useI18n();
  const runStartedAt = useAuiState((state) => currentRunStartedAt(state.thread.messages));
  const fallbackStartedAt = useRef<number | undefined>(undefined);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startedAt = runStartedAt ?? fallbackStartedAt.current ?? Date.now();
    fallbackStartedAt.current = startedAt;
    const updateElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)));
    };

    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(interval);
  }, [runStartedAt]);

  return (
    <div
      data-slot="pi-working"
      role="status"
      aria-live="polite"
      aria-label={t("workbench.chat.working")}
      className="text-foreground/70 flex min-h-[var(--assistant-turn-min-height)] w-full shrink-0 items-center gap-2 text-sm font-medium [overflow-anchor:none]"
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

function WorkbenchMessages({ isRunning }: Readonly<{ isRunning: boolean }>) {
  const { date } = useI18n();
  const messages = useThreadMessageRows();
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
    const hasAssistantMessage = message.role === "assistant" || assistantIndex !== undefined;
    const assistantMessage =
      hasAssistantMessage && messages[assistantIndex ?? index]?.role === "assistant"
        ? messages[assistantIndex ?? index]
        : undefined;
    const pairMessageIndex = assistantIndex ?? index;
    const showWorkingStatus = shouldShowWorkingStatus({
      isLastPair: isLastConversationPair(messages, pairMessageIndex),
      threadIsRunning: isRunning,
      assistantStatus: assistantMessage?.status,
    });
    const hasAssistantTurn = hasAssistantMessage || showWorkingStatus;

    items.push(
      <MessagePair
        key={conversationPairKey(message)}
        variant="flat"
        className="max-w-none gap-4 px-2 [overflow-anchor:none]"
        userMessage={
          message.role === "user" ? (
            <ThreadPrimitive.MessageByIndex index={index} components={messageComponents} />
          ) : undefined
        }
        assistantMessage={
          hasAssistantTurn ? (
            <div
              data-slot="assistant-message-slot"
              className="min-h-[var(--assistant-turn-min-height)] w-full [overflow-anchor:none]"
            >
              {hasAssistantMessage ? (
                <ThreadPrimitive.MessageByIndex
                  index={assistantIndex ?? index}
                  components={messageComponents}
                />
              ) : null}
              {showWorkingStatus ? <PiWorkingStatus /> : null}
            </div>
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
      className="mx-auto flex w-full max-w-[var(--thread-max-width)] shrink-0 flex-col gap-4 pb-4 [overflow-anchor:none]"
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
  const observedRouteId = useRef<string | null>(null);
  const syncedRouteId = useRef<string | null>(null);
  const newThreadNavigationPending = useRef(false);
  const isLoading = useAuiState((state) => state.threads.isLoading);
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const newThreadId = useAuiState((state) => state.threads.newThreadId);
  const activeMessageCount = useAuiState((state) => state.thread.messages.length);
  const threadIds = useAuiState((state) => state.threads.threadIds);
  const archivedThreadIds = useAuiState((state) => state.threads.archivedThreadIds);
  const isInitialLoading = isLoading && threadIds.length + archivedThreadIds.length === 0;
  const threadItems = useAuiState((state) => state.threads.threadItems);
  const mainThread = threadItems.find((item) => item.id === mainThreadId);

  useLayoutEffect(() => {
    const routeId = threadId ?? "";
    if (isInitialLoading) return;
    const routeChanged = observedRouteId.current !== routeId;
    observedRouteId.current = routeId;

    if (!threadId) {
      newThreadNavigationPending.current = false;
      if (routeChanged) {
        syncedRouteId.current = routeId;

        try {
          aui.threads.switchToNewThread();
        } catch {
          // The thread list can change between the state read and route update.
        }
        return;
      }

      // assistant-ui promotes the draft before its append pipeline reaches `onNew`. Navigating
      // during that gap invalidates the thread generation and silently drops the first send.
      // The optimistic user message is the earliest safe signal that `onNew` has started.
      const nextRouteId = resolvePromotedThreadRouteId({
        mainThreadId,
        newThreadId,
        status: mainThread?.status,
        remoteId: mainThread?.remoteId,
        externalId: mainThread?.externalId,
        hasMessages: activeMessageCount > 0,
      });
      if (nextRouteId) {
        if (syncedRouteId.current === nextRouteId) return;
        syncedRouteId.current = nextRouteId;
        // The root and conversation routes render the same client workbench. A full App Router
        // navigation waits for an RSC round trip before updating the address bar, which leaves a
        // submitted conversation looking like a draft for seconds. Next.js integrates the native
        // History API with its router, so project the already-active thread synchronously.
        window.history.replaceState(null, "", `/c/${encodeURIComponent(nextRouteId)}`);
      }
      return;
    }

    if (
      newThreadNavigationPending.current ||
      shouldProjectNewThreadRoute({
        routeThreadId: threadId,
        syncedRouteThreadId: syncedRouteId.current,
        isNewThread: mainThreadId === newThreadId,
      })
    ) {
      if (!newThreadNavigationPending.current) {
        newThreadNavigationPending.current = true;
        window.history.pushState(null, "", "/");
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

    const canonicalRouteId = item?.remoteId ?? item?.externalId;
    if (canonicalRouteId && canonicalRouteId !== threadId) {
      syncedRouteId.current = canonicalRouteId;
      window.history.replaceState(null, "", `/c/${encodeURIComponent(canonicalRouteId)}`);
      return;
    }

    syncedRouteId.current = routeId;
    if (resolvedId === mainThreadId) return;

    try {
      aui.threads.switchToThread(resolvedId);
    } catch {
      // A runtime can invalidate a thread between the state read and switch.
      // Keeping the current thread is the safe route-level fallback.
    }
  }, [
    activeMessageCount,
    archivedThreadIds,
    aui,
    isLoading,
    isInitialLoading,
    mainThread,
    mainThreadId,
    newThreadId,
    threadId,
    threadIds,
    threadItems,
  ]);

  return null;
}

export function WorkbenchThread() {
  const { t } = useI18n();
  const pathname = usePathname();
  const threadId = conversationThreadIdFromPathname(pathname);
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
  const scrollPositionThreadId = useRef(activeThreadId);
  const scrollRestorationActive = useRef(false);
  const scrollRestorationCleanup = useRef<(() => void) | null>(null);
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

  const stopScrollRestoration = useCallback(() => {
    scrollRestorationCleanup.current?.();
    scrollRestorationCleanup.current = null;
    scrollRestorationActive.current = false;
  }, []);

  const rememberCurrentScrollPosition = useCallback(() => {
    const viewport = viewportRef.current;
    const currentThreadId = scrollPositionThreadId.current;
    if (!viewport || !currentThreadId || scrollRestorationActive.current) return;

    const position = readViewportPosition(viewport);
    wasAtBottom.current = position.atBottom;
    saveThreadScrollPosition(currentThreadId, position);
  }, []);

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "instant" });
  }, []);

  useLayoutEffect(() => {
    stopScrollRestoration();
    scrollPositionThreadId.current = activeThreadId;

    const viewport = viewportRef.current;
    if (!viewport || !activeThreadId) return;

    const savedPosition = getThreadScrollPosition(activeThreadId);
    const restoreToBottom = savedPosition?.atBottom ?? true;
    const savedScrollTop = savedPosition?.scrollTop ?? 0;
    let frame: number | null = null;
    let timeout: number | null = null;
    let stopped = false;

    const applyPosition = () => {
      if (stopped) return;

      if (restoreToBottom) {
        scrollToBottom();
        wasAtBottom.current = true;
        return;
      }

      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      viewport.scrollTo({
        top: Math.min(savedScrollTop, maxScrollTop),
        behavior: "instant",
      });
      // Keep ThreadPrimitive's isAtBottom store in sync with the restored DOM position so
      // auto-scroll does not reclaim a deliberately restored point in the history.
      viewport.dispatchEvent(new Event("scroll"));
      wasAtBottom.current = false;
    };
    const schedulePosition = () => {
      if (stopped || frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        applyPosition();
      });
    };
    const disconnectContentObserver = observeViewportContent(viewport, schedulePosition);
    const stop = () => {
      if (stopped) return;
      stopped = true;
      disconnectContentObserver();
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (timeout !== null) window.clearTimeout(timeout);
      if (scrollRestorationCleanup.current === stop) {
        scrollRestorationCleanup.current = null;
        scrollRestorationActive.current = false;
      }
    };
    const finish = () => {
      applyPosition();
      stop();
      rememberCurrentScrollPosition();
    };

    scrollRestorationActive.current = true;
    scrollRestorationCleanup.current = stop;
    timeout = window.setTimeout(finish, 5_000);
    applyPosition();
    schedulePosition();

    return stop;
  }, [activeThreadId, rememberCurrentScrollPosition, scrollToBottom, stopScrollRestoration]);

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
      if (completionFollowActive.current || scrollRestorationActive.current) return;
      rememberCurrentScrollPosition();
    };
    const cancelScrollFollow = () => {
      stopCompletionFollow();
      stopModelChangeFollow();
      stopScrollRestoration();
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
      stopScrollRestoration();
      rememberCurrentScrollPosition();
    };
  }, [
    rememberCurrentScrollPosition,
    stopCompletionFollow,
    stopModelChangeFollow,
    stopScrollRestoration,
  ]);

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

    let settleTimer: number | null = null;
    let frame: number | null = null;
    let disconnectContentObserver = () => {};
    const stop = () => {
      disconnectContentObserver();
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (completionFollowCleanup.current === stop) {
        completionFollowCleanup.current = null;
        completionFollowActive.current = false;
      }
    };
    const keepAtBottom = () => {
      scrollToBottom();
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        scrollToBottom();
      });
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(stop, 250);
    };

    completionFollowActive.current = true;
    completionFollowCleanup.current = stop;
    // Completion can collapse reasoning/tools, remove Pi Working, and resize the sticky composer.
    // Observe every direct viewport surface so the final correction includes the true scroll end.
    disconnectContentObserver = observeViewportContent(viewport, keepAtBottom);
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
          // A one-line settled turn is at most 84px with the current completion/reasoning chrome.
          // Reserving that scaffold from the optimistic frame prevents a vertical snap.
          "--assistant-turn-min-height": "5.25rem",
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

        {/* New runs and explicit requests scroll to the end. Thread switches use the per-thread
            restoration above, while auto-scroll follows late content only when already at bottom. */}
        <ThreadPrimitive.Viewport
          ref={viewportRef}
          turnAnchor="bottom"
          autoScroll
          scrollToBottomOnInitialize={false}
          scrollToBottomOnThreadSwitch={false}
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

          <WorkbenchMessages isRunning={isRunning} />

          <SlotHost
            name="thread.after"
            context={slotContext}
            className="mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-2 [overflow-anchor:none]"
          />

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
