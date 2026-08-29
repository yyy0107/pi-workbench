"use client";

import { ThreadPrimitive, useAuiState } from "@assistant-ui/react";
import { ArrowDownIcon } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { DaySeparator } from "@/components/elements/conversation-separator";
import { MessagePair } from "@/components/elements/message-pair";
import {
  isPiWorkingWordmarkState,
  PI_WORKING_WORDMARK_ASPECT_RATIO,
  PiWorkingOrb,
} from "@/components/elements/pi-working-orb";
import { TypingIndicator } from "@/components/elements/typing-indicator";
import { useI18n } from "@/i18n";
import { formatCompactDuration } from "@/lib/format-duration";
import { cn } from "@/lib/utils";
import { SlotHost } from "@/platform/extensions/hosts/slot-host";
import { useAppearancePreferences } from "@/services/appearance/appearance-store";

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
import {
  agentAutoRetryStatus,
  agentRunTiming,
  displayedAgentRunElapsedMs,
} from "./workbench-thread-timing";
import {
  NEW_THREAD_COMPOSER_WIDTH,
  THREAD_CONTENT_COMPACT_GUTTER_PX,
  THREAD_CONTENT_MAX_WIDTH_PX,
  THREAD_CONTENT_MIN_WIDTH_PX,
  THREAD_VIEWPORT_CONTENT_WIDTH_CLASS_NAME,
} from "./thread-content-width";

interface MessageRow {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: number;
}

const THREAD_VIEWPORT_MASK_IMAGE =
  "linear-gradient(to bottom, transparent 0, #000 var(--thread-header-fade-size), #000 calc(100% - var(--composer-dock-corner-radius)), transparent 100%), linear-gradient(#000 0 0)";
const THREAD_VIEWPORT_MASK_SIZE =
  "calc(100% - var(--thread-viewport-inline-padding)) 100%, var(--thread-viewport-inline-padding) 100%";

const messageComponents = {
  UserMessage: WorkbenchUserMessage,
  AssistantMessage: WorkbenchAssistantMessage,
  SystemMessage: WorkbenchSystemMessage,
  EditComposer: WorkbenchEditComposer,
};

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

    const next = messages.map((message) => ({
      id: message.id,
      role: message.role,
      createdAt: message.createdAt.getTime(),
    }));
    previousRows.current = next;
    return next;
  });
}

function PiWorkingStatus() {
  const { locale, t } = useI18n();
  const { piWorkingOrbSize, piWorkingOrbState } = useAppearancePreferences();
  const usesWordmark = isPiWorkingWordmarkState(piWorkingOrbState);
  const runTiming = useAuiState((state) => agentRunTiming(state.thread.extras));
  const autoRetry = useAuiState((state) => agentAutoRetryStatus(state.thread.extras));
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
      ? t("workbench.chat.workingElapsed", { duration })
      : t("workbench.chat.working");
  const announcement = autoRetry
    ? t("workbench.chat.connectionInterruptedRetrying", {
        attempt: autoRetry.attempt,
        maxAttempts: autoRetry.maxAttempts,
      })
    : t("workbench.chat.working");
  const displayLabel =
    usesWordmark && !autoRetry
      ? duration
        ? t("workbench.chat.workingWordmarkElapsed", { duration })
        : undefined
      : visualLabel;

  return (
    <div
      data-slot="pi-working"
      role="status"
      aria-live="polite"
      className="text-foreground/70 flex h-10 w-full shrink-0 items-center gap-1.5 text-[13.5px] font-medium [overflow-anchor:none]"
    >
      <span className="sr-only">{announcement}</span>
      <span
        data-slot="pi-working-icon"
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center"
        style={{
          width: piWorkingOrbSize * (usesWordmark ? PI_WORKING_WORDMARK_ASPECT_RATIO : 1),
          height: piWorkingOrbSize,
        }}
      >
        <PiWorkingOrb state={piWorkingOrbState} />
      </span>
      {displayLabel ? (
        <span
          data-slot="pi-working-label"
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

  return (
    <div
      data-slot="thread-history-loading"
      role="status"
      aria-live="polite"
      className="flex min-h-0 w-full flex-1 items-center justify-center [overflow-anchor:none]"
    >
      <span className="sr-only">{t("workbench.chat.loadingHistory")}</span>
      <span aria-hidden="true" className="size-16 dark:hidden">
        <PiWorkingOrb state="pi-logo-shine" />
      </span>
      <span aria-hidden="true" className="hidden size-16 dark:block">
        <PiWorkingOrb state="pi-logo-shine-inverted" />
      </span>
    </div>
  );
}

function WorkbenchMessages({ isRunning }: Readonly<{ isRunning: boolean }>) {
  const { date } = useI18n();
  const messages = useThreadMessageRows();
  const items: ReactNode[] = [];
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
    const pairMessageIndex = assistantIndex ?? index;
    const showWorkingStatus = shouldShowWorkingStatus({
      isLastPair: isLastConversationPair(messages, pairMessageIndex),
      threadIsRunning: isRunning,
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
              className={cn(
                "w-full [overflow-anchor:none]",
                showWorkingStatus && "min-h-[var(--assistant-turn-min-height)]",
              )}
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
      className={cn(
        THREAD_VIEWPORT_CONTENT_WIDTH_CLASS_NAME,
        "mx-auto flex shrink-0 flex-col gap-4 pb-4 [overflow-anchor:none]",
      )}
    >
      {items}
    </div>
  );
}

export interface WorkbenchConversationProps {
  /** Runtime-bound thread id passed to extension Slots; no routing semantics are attached. */
  threadId?: string;
  /** Host-owned content that must render inside the Thread root before extension columns. */
  hostContent?: ReactNode;
  /** Composer rendered inside the empty-state presentation. */
  emptyComposer: ReactNode;
  /** Host-owned Composer dock or footer. */
  composerDock?: ReactNode;
  /** Whether loading the current runtime should replace messages with the history indicator. */
  showHistoryLoading?: boolean;
  viewportRef?: Ref<HTMLDivElement>;
  frameRef?: Ref<HTMLDivElement>;
  composerDockInset?: number;
  autoScroll?: boolean;
  scrollToBottomOnInitialize?: boolean;
  scrollToBottomOnThreadSwitch?: boolean;
  rootClassName?: string;
  rootDataSurface?: string;
}

/**
 * Runtime-scoped Workbench conversation UI shared by the central MainView and nested surfaces.
 *
 * Routing, persistent scroll restoration, and Composer Dock measurement are deliberately supplied
 * by the host. Everything below reads messages and actions only from the nearest assistant-ui
 * Runtime provider.
 */
export function WorkbenchConversation({
  threadId,
  hostContent,
  emptyComposer,
  composerDock,
  showHistoryLoading = false,
  viewportRef,
  frameRef,
  composerDockInset = 138,
  autoScroll,
  scrollToBottomOnInitialize = false,
  scrollToBottomOnThreadSwitch = false,
  rootClassName,
  rootDataSurface = "thread",
}: WorkbenchConversationProps) {
  const { t } = useI18n();
  const isEmpty = useAuiState((state) => state.thread.isEmpty);
  const isThreadLoading = useAuiState((state) => state.thread.isLoading);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const isHistoryLoading = showHistoryLoading && isThreadLoading;
  const hasDockedComposer = Boolean(composerDock) && (!isEmpty || isHistoryLoading);
  const slotContext = { threadId };

  return (
    <ThreadPrimitive.Root
      data-workbench-surface={rootDataSurface}
      className={cn("bg-background relative flex h-full min-h-0 min-w-0 text-base", rootClassName)}
      style={
        {
          "--thread-content-width":
            "calc(100cqw - var(--thread-content-inline-gutter, 4rem) - var(--thread-content-inline-gutter, 4rem))",
          "--thread-content-min-width": `min(${THREAD_CONTENT_MIN_WIDTH_PX}px, calc(100cqw - ${THREAD_CONTENT_COMPACT_GUTTER_PX * 2}px))`,
          "--thread-content-max-width": `min(${THREAD_CONTENT_MAX_WIDTH_PX}px, calc(100cqw - ${THREAD_CONTENT_COMPACT_GUTTER_PX * 2}px))`,
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
        ref={frameRef}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-clip [container-type:inline-size]"
        style={
          {
            "--composer-dock-inset": `${composerDockInset}px`,
            "--composer-dock-bottom-gap": "1rem",
            "--composer-dock-top-gap": "0.5rem",
            "--composer-dock-content-top-inset":
              "calc(var(--composer-dock-inset) - var(--composer-dock-top-gap))",
            "--composer-dock-corner-radius": "var(--composer-inner-radius, 1.375rem)",
            "--thread-header-fade-size": "1.375rem",
            "--thread-viewport-inline-padding": `${THREAD_CONTENT_COMPACT_GUTTER_PX}px`,
          } as CSSProperties
        }
      >
        <SlotHost
          name="thread.header"
          context={slotContext}
          className="flex shrink-0 items-center gap-2 border-b px-4 empty:hidden"
        />

        <ThreadPrimitive.Viewport
          ref={viewportRef}
          turnAnchor="bottom"
          autoScroll={autoScroll ?? isRunning}
          scrollToBottomOnInitialize={scrollToBottomOnInitialize}
          scrollToBottomOnRunStart
          scrollToBottomOnThreadSwitch={scrollToBottomOnThreadSwitch}
          className={cn(
            "relative flex min-h-0 flex-1 scroll-smooth flex-col overflow-x-hidden overflow-y-auto motion-reduce:scroll-auto [overflow-anchor:none] [padding-inline:var(--thread-viewport-inline-padding)] [scrollbar-gutter:stable_both-edges]",
            hasDockedComposer
              ? "[margin-bottom:var(--composer-dock-content-top-inset)] [padding-top:var(--thread-header-fade-size)] [padding-bottom:var(--composer-dock-corner-radius)]"
              : "pt-4",
          )}
          style={
            hasDockedComposer
              ? {
                  scrollbarColor: "var(--scrollbar-thumb) transparent",
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
              "mx-auto flex flex-col gap-2 [overflow-anchor:none]",
            )}
          />

          {isHistoryLoading ? (
            <ThreadHistoryLoading />
          ) : (
            <>
              <ThreadPrimitive.Empty>
                <WorkbenchEmpty>{emptyComposer}</WorkbenchEmpty>
              </ThreadPrimitive.Empty>

              <WorkbenchMessages isRunning={isRunning} />
            </>
          )}

          <SlotHost
            name="thread.after"
            context={slotContext}
            className={cn(
              THREAD_VIEWPORT_CONTENT_WIDTH_CLASS_NAME,
              "mx-auto flex flex-col gap-2 [overflow-anchor:none]",
            )}
          />
        </ThreadPrimitive.Viewport>

        {!isEmpty ? (
          <ThreadPrimitive.ScrollToBottom
            behavior="smooth"
            render={
              <TooltipIconButton
                tooltip={t("workbench.chat.scrollLatest")}
                variant="outline"
                size="icon"
                className="bg-background absolute bottom-[calc(var(--composer-dock-inset)+0.5rem)] left-1/2 z-30 size-8 -translate-x-1/2 rounded-full shadow-sm disabled:invisible"
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
        ) : null}

        {hasDockedComposer ? composerDock : null}
      </div>

      <SlotHost
        name="thread.right"
        context={slotContext}
        className="flex h-full min-h-0 shrink-0 flex-col empty:hidden"
      />
    </ThreadPrimitive.Root>
  );
}
