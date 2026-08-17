"use client";

import { useEffect, useRef } from "react";
import { ThreadPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { ArrowDownIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
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
  const activeThreadId = useAuiState((state) => state.threads.mainThreadId);
  const slotContext = { threadId: threadId ?? activeThreadId };

  return (
    <ThreadPrimitive.Root
      className="bg-background flex h-full min-h-0 flex-col text-base"
      style={
        {
          "--thread-max-width": "48rem",
        } as React.CSSProperties
      }
    >
      <ThreadRouteSync threadId={threadId} />
      <SlotHost
        name="thread.header"
        context={slotContext}
        className="flex shrink-0 items-center gap-2 border-b px-4 empty:hidden"
      />

      <ThreadPrimitive.Viewport
        turnAnchor="top"
        className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto scroll-smooth px-4 pt-4"
      >
        <SlotHost
          name="thread.before"
          context={slotContext}
          className="mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-2"
        />

        <ThreadPrimitive.Empty>
          <WorkbenchEmpty />
        </ThreadPrimitive.Empty>

        <ThreadPrimitive.Messages>
          {({ message }) => {
            if (message.composer.isEditing) return <WorkbenchEditComposer />;

            switch (message.role) {
              case "user":
                return <WorkbenchUserMessage />;
              case "assistant":
                return <WorkbenchAssistantMessage />;
              case "system":
                return <WorkbenchSystemMessage />;
            }
          }}
        </ThreadPrimitive.Messages>

        <SlotHost
          name="thread.after"
          context={slotContext}
          className="mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-2"
        />

        <ThreadPrimitive.ScrollToBottom
          render={
            <TooltipIconButton
              tooltip="Scroll to latest"
              variant="outline"
              className="bg-background sticky bottom-44 z-10 mx-auto size-8 shrink-0 rounded-full shadow-sm"
            />
          }
        >
          <ArrowDownIcon className="size-4" />
        </ThreadPrimitive.ScrollToBottom>

        <ThreadPrimitive.ViewportFooter className="bg-background/95 sticky bottom-0 mx-auto mt-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-3 rounded-t-3xl pb-4 pt-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <WorkbenchComposer />
          <p className="text-muted-foreground px-4 text-center text-[11px]">
            AI responses can be inaccurate. Check important information.
          </p>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
