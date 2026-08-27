"use client";

import type { PointerEvent } from "react";
import {
  ThreadListItemMorePrimitive,
  ThreadListItemPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import { ArchiveIcon, MoreHorizontalIcon, PinIcon, PinOffIcon } from "lucide-react";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  useWorkbenchAgentThreadActions,
  useWorkbenchAgentThreadSnapshot,
} from "@/runtime/assistant-ui/agent-runtime-context";
import { useAppearancePreferences } from "@/services/appearance/appearance-store";
import { useWorkspaceCapabilities } from "@/services/workspace-selection-service";
import { conversationThreadIdFromPathname } from "@/workbench/workspaces/new-thread-policy";

import { RunningThreadIndicator } from "./running-thread-indicator";
import type { ThreadDropPosition } from "./thread-sort";

export function WorkbenchThreadListItem({
  workspaceId,
  sortOrder,
  dragEnabled = false,
  dragging = false,
  dropPosition,
  registerDragElement,
  onPointerDown,
  shouldSuppressNavigation,
  onNavigate,
}: {
  workspaceId?: string;
  sortOrder?: number;
  dragEnabled?: boolean;
  dragging?: boolean;
  dropPosition?: ThreadDropPosition;
  registerDragElement?: (element: HTMLElement | null) => void;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  shouldSuppressNavigation?: () => boolean;
  onNavigate?: () => void;
}) {
  const { date: formatDate, relativeTime, t } = useI18n();
  const { runningIndicatorId } = useAppearancePreferences();
  const aui = useAui();
  const threadActions = useWorkbenchAgentThreadActions();
  const pathname = usePathname();
  const runtimeIsRunning = useAuiState((state) => state.threadListItem.isRunning);
  const runtimeTitle = useAuiState((state) => state.threadListItem.title);
  const runtimeLastMessageAt = useAuiState((state) => state.threadListItem.lastMessageAt);
  const isActive = useAuiState((state) => state.threads.mainThreadId === state.threadListItem.id);
  const routeThreadId = useAuiState(
    (state) =>
      state.threadListItem.remoteId ?? state.threadListItem.externalId ?? state.threadListItem.id,
  );
  const threadState = useWorkbenchAgentThreadSnapshot(routeThreadId);
  const hasEmptyNewThread = useAuiState(
    (state) =>
      state.threads.mainThreadId === state.threads.newThreadId &&
      state.thread.messages.length === 0,
  );
  const { activateWorkspace, deactivateWorkspace, destroyNewThread } = useWorkspaceCapabilities();
  const isPinned = threadState.isPinned;
  const isRunning = runtimeIsRunning || threadState.isRunning;
  const waitingForUserInput = !isActive && threadState.isWaitingForInput;
  const title = threadState.title ?? runtimeTitle;
  const lastMessageAt = threadState.lastMessageAt ?? runtimeLastMessageAt;
  const openThreadRoute = () => {
    destroyNewThread();
    if (hasEmptyNewThread) {
      void aui.thread
        .composer()
        .reset()
        .catch((error) => console.error("[workbench] failed to discard empty conversation", error));
    }
    if (workspaceId) activateWorkspace(workspaceId);
    else deactivateWorkspace();
    const href = `/c/${encodeURIComponent(routeThreadId)}`;
    if (window.location.pathname !== href) window.history.pushState(null, "", href);
    onNavigate?.();
  };
  const leaveRemovedThreadRoute = () => {
    if (isActive || conversationThreadIdFromPathname(pathname) === routeThreadId) {
      window.history.replaceState(null, "", "/");
      onNavigate?.();
    }
  };
  const togglePinned = async () => {
    if (!threadActions.setPinned) return;
    try {
      await threadActions.setPinned(routeThreadId, !isPinned);
    } catch (error) {
      console.error("[workbench] failed to update pinned conversation", error);
    }
  };
  const formattedTime = (() => {
    if (!lastMessageAt) return undefined;

    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - lastMessageAt.getTime()) / 60_000));
    if (elapsedMinutes < 1) return relativeTime(0, "minute");
    if (elapsedMinutes < 60) return relativeTime(-elapsedMinutes, "minute");

    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours < 24) return relativeTime(-elapsedHours, "hour");

    const elapsedDays = Math.floor(elapsedHours / 24);
    if (elapsedDays < 7) return relativeTime(-elapsedDays, "day");

    return formatDate(lastMessageAt, { month: "numeric", day: "numeric" });
  })();

  return (
    <ThreadListItemPrimitive.Root
      data-workbench-selection-surface=""
      data-workbench-selection-mode="foreground"
      data-dragging={dragging ? "" : undefined}
      ref={registerDragElement}
      style={sortOrder === undefined ? undefined : { order: sortOrder }}
      className={cn(
        "group/thread text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-within:bg-sidebar-accent focus-within:text-sidebar-foreground data-active:text-sidebar-foreground relative -ms-6 flex min-h-[var(--control-hit-touch)] items-center rounded-lg transition-[color,background-color,opacity] md:min-h-9",
        dragEnabled && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
      )}
      onPointerDown={onPointerDown}
    >
      {dropPosition ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute start-2 end-2 z-20 h-0.5 rounded-full bg-blue-500",
            dropPosition === "before" ? "-top-px" : "-bottom-px",
          )}
        >
          <span className="absolute start-0 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500" />
        </span>
      ) : null}
      {isRunning ? (
        <RunningThreadIndicator
          id={runningIndicatorId}
          className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2"
        />
      ) : null}
      <ThreadListItemPrimitive.Trigger
        className="focus-visible:ring-sidebar-ring flex h-[var(--control-hit-touch)] min-w-0 flex-1 items-center rounded-lg pe-2.5 ps-[34px] text-start text-sm outline-none focus-visible:ring-2 md:h-9"
        onClick={(event) => {
          if (shouldSuppressNavigation?.()) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          openThreadRoute();
        }}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate md:group-hover/thread:pe-14 md:group-has-[:focus-visible]/thread:pe-14",
            !waitingForUserInput && "pe-10 md:pe-0",
          )}
        >
          {title || t("workbench.sidebar.newThread")}
        </span>
        {waitingForUserInput ? (
          <span
            aria-hidden="true"
            className="ms-2 me-10 shrink-0 text-[11px] text-amber-700 md:me-0 md:group-hover/thread:hidden md:group-has-[:focus-visible]/thread:hidden dark:text-amber-300"
          >
            {t("workbench.sidebar.waitingForUserInput")}
          </span>
        ) : !isRunning && threadState.hasUnreadCompletion ? (
          <>
            <span
              aria-hidden="true"
              className="bg-primary ms-2 size-2 shrink-0 rounded-full max-md:hidden group-hover/thread:hidden group-has-[:focus-visible]/thread:hidden"
            />
            <span className="sr-only">{t("workbench.sidebar.completed")}</span>
          </>
        ) : !isRunning && lastMessageAt ? (
          <span className="text-muted-foreground ms-2 shrink-0 text-[11px] tabular-nums max-md:hidden group-hover/thread:hidden group-has-[:focus-visible]/thread:hidden">
            {formattedTime}
          </span>
        ) : null}
        {waitingForUserInput ? (
          <span className="sr-only">{t("workbench.sidebar.waitingForUserInput")}</span>
        ) : isRunning ? (
          <span className="sr-only">{t("workbench.sidebar.generating")}</span>
        ) : null}
      </ThreadListItemPrimitive.Trigger>

      <div data-thread-item-actions="" className="absolute end-0 flex items-center md:hidden">
        <ThreadListItemMorePrimitive.Root sharedFocusGroup>
          <ThreadListItemMorePrimitive.Trigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("workbench.sidebar.conversationOptions")}
                className="text-muted-foreground hover:text-foreground size-[var(--control-hit-touch)]! rounded-lg data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground"
              />
            }
          >
            <MoreHorizontalIcon className="size-4" />
          </ThreadListItemMorePrimitive.Trigger>
          <ThreadListItemMorePrimitive.Content
            side="bottom"
            align="end"
            sideOffset={4}
            className="bg-popover/95 text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 z-50 min-w-44 overflow-hidden rounded-xl border p-1.5 shadow-lg backdrop-blur-sm motion-reduce:animate-none"
          >
            {threadActions.setPinned ? (
              <ThreadListItemMorePrimitive.Item
                className="hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex min-h-[var(--control-hit-touch)] cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none select-none"
                onSelect={() => void togglePinned()}
              >
                {isPinned ? <PinOffIcon className="size-4" /> : <PinIcon className="size-4" />}
                {t(isPinned ? "workbench.sidebar.unpin" : "workbench.sidebar.pin")}
              </ThreadListItemMorePrimitive.Item>
            ) : null}
            <ThreadListItemPrimitive.Archive
              onClick={leaveRemovedThreadRoute}
              render={
                <ThreadListItemMorePrimitive.Item className="hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex min-h-[var(--control-hit-touch)] cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none select-none" />
              }
            >
              <ArchiveIcon className="size-4" />
              {t("workbench.sidebar.archive")}
            </ThreadListItemPrimitive.Archive>
          </ThreadListItemMorePrimitive.Content>
        </ThreadListItemMorePrimitive.Root>
      </div>

      <div
        data-thread-item-actions=""
        className="pointer-events-none absolute end-0 hidden items-center opacity-0 transition-opacity md:flex md:group-hover/thread:pointer-events-auto md:group-hover/thread:opacity-100 md:group-has-[:focus-visible]/thread:pointer-events-auto md:group-has-[:focus-visible]/thread:opacity-100"
      >
        {threadActions.setPinned ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t(isPinned ? "workbench.sidebar.unpin" : "workbench.sidebar.pin")}
            aria-pressed={isPinned}
            title={t(isPinned ? "workbench.sidebar.unpin" : "workbench.sidebar.pin")}
            className={cn(
              "text-muted-foreground hover:text-foreground size-8! active:scale-90",
              isPinned && "text-foreground",
            )}
            onClick={() => void togglePinned()}
          >
            {isPinned ? <PinOffIcon className="size-4" /> : <PinIcon className="size-4" />}
          </Button>
        ) : null}
        <ThreadListItemPrimitive.Archive
          onClick={leaveRemovedThreadRoute}
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("workbench.sidebar.archive")}
              title={t("workbench.sidebar.archive")}
              className="text-muted-foreground hover:text-foreground size-8! active:scale-90"
            />
          }
        >
          <ArchiveIcon className="size-4" />
        </ThreadListItemPrimitive.Archive>
      </div>
    </ThreadListItemPrimitive.Root>
  );
}
