"use client";

import { ArrowDownIcon } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  SessionProvider,
  useConversationSession,
  useSessionState,
} from "@workbench/agent-runtime-client";
import { Button } from "../ui/button";
import { TypingIndicator } from "../elements/typing-indicator";
import { useI18n } from "../i18n";
import { formatCompactDuration } from "../format-duration";
import { cn } from "../utils";
import { useWorkbenchBranding } from "../presentation";
import { RunningIndicator, useRunningIndicatorCatalog } from "../running-indicator";
import { SlotHost } from "@workbench/extension-host/hosts/slot-host";
import { useAppearancePreferences } from "../appearance";
import {
  NEW_THREAD_COMPOSER_WIDTH,
  THREAD_CONTENT_COMPACT_GUTTER_PX,
  THREAD_CONTENT_MAX_WIDTH_PX,
  THREAD_CONTENT_WIDTH,
  THREAD_CONTENT_WIDTH_CLASS_NAME,
  THREAD_VIEWPORT_CONTENT_WIDTH_CLASS_NAME,
} from "../layout";

import { WorkbenchEmpty } from "./workbench-empty";
import { ConversationList } from "./conversation-list";
import { useWorkbenchConversationViewport } from "./workbench-conversation-viewport";
import { displayedAgentRunElapsedMs } from "./workbench-thread-timing";

const THREAD_VIEWPORT_MASK_IMAGE =
  "linear-gradient(to bottom, transparent 0, #000 var(--thread-header-fade-size), #000 calc(100% - var(--composer-dock-corner-radius)), transparent 100%), linear-gradient(#000 0 0)";
const THREAD_VIEWPORT_MASK_SIZE =
  "calc(100% - var(--thread-viewport-inline-padding)) 100%, var(--thread-viewport-inline-padding) 100%";
const THREAD_INLINE_GUTTER_CLASS_NAME =
  "[padding-inline:var(--thread-viewport-inline-padding)] [scrollbar-gutter:stable_both-edges]";

function AssistantWorkingStatus() {
  const { locale, t } = useI18n();
  const { runtimeName } = useWorkbenchBranding();
  const { runningIndicatorSize, runningIndicatorStyleId } = useAppearancePreferences();
  const indicatorDefinition = useRunningIndicatorCatalog().resolve(runningIndicatorStyleId);
  const indicatorPresentation = indicatorDefinition.presentation;
  const runTiming = useSessionState((snapshot) => snapshot.runTiming);
  const autoRetry = useSessionState((snapshot) => snapshot.autoRetry);
  const [elapsedMs, setElapsedMs] = useState<number | undefined>(runTiming?.elapsedMs);

  useEffect(() => {
    if (!runTiming) {
      setElapsedMs(undefined);
      return;
    }
    const updateElapsed = () => {
      setElapsedMs(displayedAgentRunElapsedMs(runTiming, performance.now()));
    };

    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(interval);
  }, [runTiming]);

  const duration =
    elapsedMs === undefined
      ? undefined
      : formatCompactDuration(elapsedMs, locale, { includeZero: true });
  const visualLabel = autoRetry
    ? duration
      ? t("workbench.chat.connectionInterruptedRetryingElapsed", {
          attempt: autoRetry.attempt,
          maxAttempts: autoRetry.maxAttempts,
          duration,
        })
      : t("workbench.chat.connectionInterruptedRetrying", {
          attempt: autoRetry.attempt,
          maxAttempts: autoRetry.maxAttempts,
        })
    : duration
      ? t("workbench.chat.workingElapsed", { runtimeName, duration })
      : t("workbench.chat.working", { runtimeName });
  const announcement = autoRetry
    ? t("workbench.chat.connectionInterruptedRetrying", {
        attempt: autoRetry.attempt,
        maxAttempts: autoRetry.maxAttempts,
      })
    : t("workbench.chat.working", { runtimeName });
  const displayLabel =
    indicatorPresentation?.hideLabel && !autoRetry
      ? duration
        ? t("workbench.chat.elapsedOnly", { duration })
        : undefined
      : visualLabel;

  return (
    <div
      data-slot="assistant-working"
      role="status"
      aria-live="polite"
      className="text-foreground/70 flex h-10 w-full shrink-0 items-center gap-1.5 text-[13.5px] font-medium [overflow-anchor:none]"
    >
      <span className="sr-only">{announcement}</span>
      <span
        data-slot="assistant-working-icon"
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center"
        style={{
          width: runningIndicatorSize * (indicatorPresentation?.aspectRatio ?? 1),
          height: runningIndicatorSize,
        }}
      >
        <RunningIndicator styleId={indicatorDefinition.id} />
      </span>
      {displayLabel ? (
        <span
          data-slot="assistant-working-label"
          aria-hidden="true"
          className="shimmer [--shimmer-color:black] [--shimmer-repeat-delay:900] [--shimmer-speed:180] [--shimmer-spread:52px] motion-reduce:animate-none"
        >
          {displayLabel}
        </span>
      ) : null}
    </div>
  );
}

function ThreadHistoryLoading() {
  const { t } = useI18n();
  const activityIndicators = useRunningIndicatorCatalog();

  return (
    <div
      data-slot="thread-history-loading"
      role="status"
      aria-live="polite"
      className="flex min-h-0 w-full flex-1 items-center justify-center [overflow-anchor:none]"
    >
      <span className="sr-only">{t("workbench.chat.loadingHistory")}</span>
      <span aria-hidden="true" className="size-16">
        <RunningIndicator styleId={activityIndicators.defaultStyleId} />
      </span>
    </div>
  );
}

export interface WorkbenchConversationProps {
  /** Runtime-bound thread id passed to extension Slots; no routing semantics are attached. */
  threadId?: string;
  /** Stable Headless Runtime Session id; defaults to the Runtime's current Session. */
  sessionId?: string;
  /** Host-owned content that must render inside the Thread root before extension columns. */
  hostContent?: ReactNode;
  /** Composer rendered inside the empty-state presentation. */
  emptyComposer: ReactNode;
  /** Host-owned Composer dock or footer. */
  composerDock?: ReactNode;
  /** Whether loading the current runtime should replace messages with the history indicator. */
  showHistoryLoading?: boolean;
  autoScroll?: boolean;
  scrollToBottomOnInitialize?: boolean;
  rootClassName?: string;
  rootDataSurface?: string;
}

/**
 * Runtime-scoped Workbench conversation UI shared by the central MainView and nested surfaces.
 *
 * Hosts supply routing and Composer content. The shared frame owns responsive layout and
 * scrolling reads the Headless Session.
 */
export function WorkbenchConversationContent({
  threadId,
  hostContent,
  emptyComposer,
  composerDock,
  showHistoryLoading = false,
  autoScroll,
  scrollToBottomOnInitialize = false,
  rootClassName,
  rootDataSurface = "thread",
}: Omit<WorkbenchConversationProps, "sessionId">) {
  const { t } = useI18n();
  const session = useConversationSession();
  const nodeKeys = useSessionState((snapshot) => snapshot.nodeKeys);
  const isThreadLoading = useSessionState((snapshot) => snapshot.isLoading);
  // Session selection is an external-store update, so a transition around the click cannot
  // defer it. Paint the loading frame first, then mount history in an interruptible render.
  const isHistoryReady = useDeferredValue(!isThreadLoading, false);
  const isRunning = useSessionState((snapshot) => snapshot.isRunning);
  const hasMore = useSessionState((snapshot) => snapshot.hasMore);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const isEmpty = nodeKeys.length === 0;
  const isHistoryLoading = showHistoryLoading && (isThreadLoading || !isHistoryReady);
  const hasDockedComposer = Boolean(composerDock) && (!isEmpty || isHistoryLoading);
  const slotContext = { threadId };
  const loadOlder = useCallback(() => {
    if (!hasMore || isLoadingOlder || !session.actions.loadOlder) return;
    setIsLoadingOlder(true);
    void session.actions
      .loadOlder()
      .catch((error) =>
        console.error("[workbench] failed to load older conversation history", error),
      )
      .finally(() => setIsLoadingOlder(false));
  }, [hasMore, isLoadingOlder, session.actions]);
  const viewport = useWorkbenchConversationViewport({
    autoScroll: autoScroll ?? isRunning,
    isRunning,
    nodeKeys,
    onReachTop: loadOlder,
    scrollToBottomOnInitialize,
    sessionId: session.id,
  });
  return (
    <div
      data-workbench-surface={rootDataSurface}
      data-slot="workbench-conversation"
      className={cn(
        "bg-background relative flex h-full w-full min-h-0 min-w-0 text-base",
        rootClassName,
      )}
      style={
        {
          "--thread-content-max-width": `min(${THREAD_CONTENT_MAX_WIDTH_PX}px, 100%)`,
          "--new-thread-composer-width": NEW_THREAD_COMPOSER_WIDTH,
          // Reserve the active optimistic turn's scaffold to prevent a vertical snap. Completed
          // turns return to their natural height so compact status rows do not create large gaps.
          "--assistant-turn-min-height": "5.25rem",
        } as CSSProperties
      }
    >
      {hostContent}
      <SlotHost
        name="thread.left"
        context={slotContext}
        className="flex h-full min-h-0 shrink-0 flex-col empty:hidden"
      />

      <div
        data-slot="conversation-layout"
        className="relative grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden transition-[--thread-content-inline-gutter] duration-(--thread-index-motion-duration) ease-(--layout-motion-ease) motion-reduce:transition-none"
        style={
          {
            "--composer-dock-bottom-gap": "1rem",
            "--composer-dock-top-gap": "0.5rem",
            "--composer-dock-corner-radius": "var(--composer-inner-radius, 1.375rem)",
            "--thread-header-fade-size": "1.375rem",
            "--thread-viewport-inline-padding": `${THREAD_CONTENT_COMPACT_GUTTER_PX}px`,
            gridTemplateColumns: `minmax(0, 1fr) minmax(0, ${THREAD_CONTENT_WIDTH}) minmax(0, 1fr)`,
          } as CSSProperties
        }
      >
        <SlotHost
          name="thread.header"
          context={slotContext}
          className="col-span-full row-start-1 flex min-w-0 items-center gap-2 border-b px-4 empty:hidden"
        />

        <div
          ref={viewport.viewportRef}
          data-slot="conversation-viewport"
          className={cn(
            "relative col-span-full row-start-2 mx-[calc(var(--scrollbar-hit-padding)/4)] min-h-0 min-w-0 scroll-smooth overflow-x-hidden overflow-y-auto motion-reduce:scroll-auto [overflow-anchor:none]",
            isEmpty || isHistoryLoading
              ? "flex flex-col"
              : "grid auto-rows-max grid-cols-subgrid content-start",
            THREAD_INLINE_GUTTER_CLASS_NAME,
            hasDockedComposer
              ? "[padding-top:var(--thread-header-fade-size)] [padding-bottom:var(--composer-dock-corner-radius)]"
              : "pt-4",
          )}
          style={
            hasDockedComposer
              ? {
                  WebkitMaskImage: THREAD_VIEWPORT_MASK_IMAGE,
                  maskImage: THREAD_VIEWPORT_MASK_IMAGE,
                  WebkitMaskPosition: "left top, right top",
                  maskPosition: "left top, right top",
                  WebkitMaskRepeat: "no-repeat",
                  maskRepeat: "no-repeat",
                  WebkitMaskSize: THREAD_VIEWPORT_MASK_SIZE,
                  maskSize: THREAD_VIEWPORT_MASK_SIZE,
                }
              : undefined
          }
        >
          <SlotHost
            name="thread.before"
            context={slotContext}
            className={cn(
              THREAD_VIEWPORT_CONTENT_WIDTH_CLASS_NAME,
              "flex flex-col gap-2 [overflow-anchor:none]",
            )}
          />

          {isHistoryLoading ? (
            <ThreadHistoryLoading />
          ) : (
            <>
              {isEmpty ? <WorkbenchEmpty>{emptyComposer}</WorkbenchEmpty> : null}
              <ConversationList renderWorkingStatus={() => <AssistantWorkingStatus />} />
            </>
          )}

          <SlotHost
            name="thread.after"
            context={slotContext}
            className={cn(
              THREAD_VIEWPORT_CONTENT_WIDTH_CLASS_NAME,
              "flex flex-col gap-2 [overflow-anchor:none]",
            )}
          />
        </div>

        {!isEmpty || hasDockedComposer ? (
          <div
            className={cn(
              "relative col-start-2 row-start-3 w-full min-w-0",
              hasDockedComposer &&
                "pt-[var(--composer-dock-top-gap)] pb-[var(--composer-dock-bottom-gap)]",
            )}
          >
            {!isEmpty ? (
              <Button
                type="button"
                aria-label={t("workbench.chat.scrollLatest")}
                data-frame="none"
                variant="outline"
                size="icon"
                disabled={viewport.isAtBottom}
                onClick={() => viewport.scrollToBottom(isRunning ? "instant" : "auto")}
                className="bg-background absolute -top-2 left-1/2 z-30 -translate-x-1/2 -translate-y-full rounded-full shadow-sm disabled:invisible"
              >
                {isRunning ? (
                  <TypingIndicator
                    label={t("workbench.chat.scrollLatest")}
                    variant="bare"
                    aria-hidden="true"
                    className="scale-75"
                  />
                ) : (
                  <ArrowDownIcon />
                )}
              </Button>
            ) : null}
            {hasDockedComposer ? (
              <div
                data-workbench-composer-dock=""
                className={cn(
                  THREAD_CONTENT_WIDTH_CLASS_NAME,
                  "relative z-20 flex flex-col bg-transparent [overflow-anchor:none]",
                )}
              >
                {composerDock}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <SlotHost
        name="thread.right"
        context={slotContext}
        className="flex h-full min-h-0 shrink-0 flex-col empty:hidden"
      />
    </div>
  );
}

export function WorkbenchConversation({ sessionId, ...props }: WorkbenchConversationProps) {
  return (
    <SessionProvider sessionId={sessionId}>
      <WorkbenchConversationContent {...props} />
    </SessionProvider>
  );
}
