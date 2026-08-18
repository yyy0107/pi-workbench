"use client";

import { useEffect, useRef } from "react";
import { ThreadPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { ArrowDownIcon } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { MessagePair } from "@/components/elements/message-pair";
import { TypingIndicator } from "@/components/elements/typing-indicator";
import { useI18n } from "@/i18n";
import { SlotHost } from "@/platform/extensions";

import { WorkbenchComposer } from "./workbench-composer";
import { WorkbenchEmpty } from "./workbench-empty";
import {
  WorkbenchAssistantMessage,
  WorkbenchEditComposer,
  WorkbenchSystemMessage,
  WorkbenchUserMessage,
} from "./workbench-message";

export interface WorkbenchThreadProps {
  threadId?: string;
}

interface MessageRow {
  id: string;
  role: "user" | "assistant" | "system";
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
        (row, index) => row.id === messages[index]?.id && row.role === messages[index]?.role,
      )
    ) {
      return previous;
    }

    const next = messages.map(({ id, role }) => ({ id, role }));
    previousRows.current = next;
    return next;
  });
}

function PiWorkingStatus() {
  const { t } = useI18n();
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const isEmpty = useAuiState((state) => state.thread.isEmpty);

  if (isEmpty) return null;

  return (
    <div
      data-slot="pi-working"
      role="status"
      aria-live={isRunning ? "polite" : "off"}
      aria-hidden={isRunning ? undefined : true}
      className={`text-foreground/70 mx-auto mb-4 flex h-[26px] w-full max-w-[var(--thread-max-width)] shrink-0 items-center gap-2 px-2 text-sm font-medium [overflow-anchor:auto] ${isRunning ? "visible" : "invisible pointer-events-none"}`}
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
        className="shimmer [--shimmer-color:white] [--shimmer-repeat-delay:900] [--shimmer-speed:180] [--shimmer-spread:52px] motion-reduce:animate-none"
      >
        {t("workbench.chat.working")}
      </span>
    </div>
  );
}

function WorkbenchMessages() {
  const messages = useThreadMessageRows();
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const items: React.ReactNode[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;

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
      message.role === "user" && nextMessage?.role === "assistant" ? index + 1 : undefined;
    const pairMessageIndex = assistantIndex ?? index;
    const isLastPair = pairMessageIndex === messages.length - 1;

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
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const slotContext = { threadId: threadId ?? activeThreadId };

  return (
    <ThreadPrimitive.Root
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
            <WorkbenchEmpty />
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

          <ThreadPrimitive.ViewportFooter className="bg-background/95 sticky bottom-0 mx-auto mt-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-3 rounded-t-3xl pb-4 pt-2 backdrop-blur [overflow-anchor:none] supports-[backdrop-filter]:bg-background/80">
            <WorkbenchComposer />
          </ThreadPrimitive.ViewportFooter>
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
