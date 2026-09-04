"use client";

import type { PointerEvent } from "react";
import { ArchiveIcon, Clock3Icon, MoreHorizontalIcon, PinIcon, PinOffIcon } from "lucide-react";
import {
  useAgentRuntime,
  useCurrentSession,
  type ThreadListItem,
} from "@workbench/agent-runtime-client";

import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useI18n } from "../i18n";
import { cn } from "../utils";
import { useAppearancePreferences } from "../appearance";
import { useWorkspaceCapabilities } from "@workbench/agent-runtime-client/workspaces";
import { useWorkbenchNavigation } from "../navigation";

import { RunningThreadIndicator } from "./running-thread-indicator";
import type { ThreadDropPosition } from "./thread-sort";

export function WorkbenchThreadListItem({
  thread,
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
  thread: ThreadListItem;
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
  const runtime = useAgentRuntime();
  const threadActions = runtime.threadActions;
  const current = useCurrentSession();
  const navigation = useWorkbenchNavigation();
  const routeThreadId = thread.threadId;
  const isActive = current.threadId === routeThreadId;
  const { activateWorkspace, deactivateWorkspace, destroyNewThread } = useWorkspaceCapabilities();
  const isPinned = thread.isPinned;
  const isRunning = thread.isRunning;
  const isAutomationTask = thread.origin?.kind === "automation";
  const waitingForUserInput = !isActive && thread.isWaitingForInput;
  const title = thread.title;
  const lastMessageAt = thread.updatedAt ? new Date(thread.updatedAt) : undefined;
  const openThreadRoute = () => {
    destroyNewThread();
    if (!isPinned) {
      if (workspaceId) activateWorkspace(workspaceId);
      else deactivateWorkspace();
    }
    if (navigation.currentConversationId !== routeThreadId) {
      navigation.openConversation(routeThreadId);
    }
    onNavigate?.();
  };
  const leaveRemovedThreadRoute = () => {
    if (isActive || navigation.currentConversationId === routeThreadId) {
      navigation.openHome({ replace: true });
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
    <div
      data-workbench-selection-surface=""
      data-workbench-selection-mode="foreground"
      data-dragging={dragging ? "" : undefined}
      data-active={isActive ? "" : undefined}
      ref={registerDragElement}
      style={sortOrder === undefined ? undefined : { order: sortOrder }}
      className={cn(
        "group/thread text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-within:bg-sidebar-accent focus-within:text-sidebar-foreground data-active:text-sidebar-foreground relative -ms-6 flex min-h-[var(--control-hit-touch)] items-center rounded-lg transition-[color,background-color] md:min-h-9",
        dragEnabled && "cursor-grab active:cursor-grabbing",
        dragging && "cursor-grabbing",
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
      {isRunning && !isPinned ? (
        <RunningThreadIndicator
          id={runningIndicatorId}
          className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2"
        />
      ) : null}
      <button
        type="button"
        aria-current={isActive ? "page" : undefined}
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
            "min-w-0 flex flex-1 items-center leading-[var(--control-text-line-height)] md:group-hover/thread:pe-[var(--sidebar-action-pair-reserved-space)] md:group-has-[:focus-visible]/thread:pe-[var(--sidebar-action-pair-reserved-space)]",
            !waitingForUserInput && "pe-[var(--sidebar-action-touch-reserved-space)] md:pe-0",
          )}
        >
          {isAutomationTask ? (
            <span
              title={t("workbench.sidebar.automationTask")}
              className={cn(
                "text-muted-foreground inline-flex shrink-0",
                isPinned ? "ms-[calc(var(--icon-frame-size-compact)*-1)] me-2" : "me-1.5",
              )}
            >
              <Clock3Icon aria-hidden="true" className="size-[var(--icon-size-md)]" />
              <span className="sr-only">{t("workbench.sidebar.automationTask")}</span>
            </span>
          ) : null}
          {isRunning && isPinned ? (
            <RunningThreadIndicator
              id={runningIndicatorId}
              className={cn(
                "pointer-events-none me-2 size-[var(--icon-size-md)] shrink-0",
                !isAutomationTask && "ms-[calc(var(--icon-frame-size-compact)*-1)]",
              )}
            />
          ) : null}
          <span
            className={cn(
              "min-w-0 translate-y-[var(--control-text-offset-y)] truncate",
              isPinned &&
                !isAutomationTask &&
                !isRunning &&
                "ms-[calc(var(--icon-frame-size-compact)*-1)]",
            )}
          >
            {title || t("workbench.sidebar.newThread")}
          </span>
        </span>
        {waitingForUserInput ? (
          <span
            aria-hidden="true"
            className="ms-2 me-[var(--sidebar-action-touch-reserved-space)] shrink-0 text-[11px] text-amber-700 md:me-0 md:group-hover/thread:hidden md:group-has-[:focus-visible]/thread:hidden dark:text-amber-300"
          >
            {t("workbench.sidebar.waitingForUserInput")}
          </span>
        ) : !isRunning && thread.hasUnreadCompletion ? (
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
      </button>

      <div
        data-sidebar-actions=""
        data-sidebar-actions-mobile-touch=""
        data-thread-item-actions=""
        className="absolute end-0 flex md:hidden"
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("workbench.sidebar.conversationOptions")}
                className="text-muted-foreground hover:text-foreground rounded-lg data-[state=open]:[background:var(--button-background-selected)] data-[state=open]:[color:var(--button-foreground-selected)]"
              />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            align="end"
            sideOffset={4}
            className="bg-popover/95 text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 z-50 min-w-44 overflow-hidden rounded-xl border p-1.5 shadow-lg backdrop-blur-sm motion-reduce:animate-none"
          >
            {threadActions.setPinned ? (
              <DropdownMenuItem
                className="hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex min-h-[var(--control-hit-touch)] cursor-pointer items-center gap-2 rounded-lg px-2.5 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] text-sm leading-[var(--control-text-line-height)]! outline-none select-none"
                onClick={() => void togglePinned()}
              >
                {isPinned ? (
                  <PinOffIcon className="size-[var(--icon-size-md)]" />
                ) : (
                  <PinIcon className="size-[var(--icon-size-md)]" />
                )}
                {t(isPinned ? "workbench.sidebar.unpin" : "workbench.sidebar.pin")}
              </DropdownMenuItem>
            ) : null}
            {threadActions.archive ? (
              <DropdownMenuItem
                className="hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex min-h-[var(--control-hit-touch)] cursor-pointer items-center gap-2 rounded-lg px-2.5 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] text-sm leading-[var(--control-text-line-height)]! outline-none select-none"
                onClick={() => {
                  leaveRemovedThreadRoute();
                  void threadActions
                    .archive?.(routeThreadId)
                    .catch((error) =>
                      console.error("[workbench] failed to archive conversation", error),
                    );
                }}
              >
                <ArchiveIcon className="size-[var(--icon-size-md)]" />
                {t("workbench.sidebar.archive")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        data-sidebar-actions=""
        data-thread-item-actions=""
        className="pointer-events-none absolute end-0 hidden opacity-0 transition-opacity md:flex md:group-hover/thread:pointer-events-auto md:group-hover/thread:opacity-100 md:group-has-[:focus-visible]/thread:pointer-events-auto md:group-has-[:focus-visible]/thread:opacity-100"
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
              "text-muted-foreground hover:text-foreground active:scale-90",
              isPinned && "text-foreground",
            )}
            onClick={() => void togglePinned()}
          >
            {isPinned ? <PinOffIcon /> : <PinIcon />}
          </Button>
        ) : null}
        {threadActions.archive ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("workbench.sidebar.archive")}
            title={t("workbench.sidebar.archive")}
            className="text-muted-foreground hover:text-foreground active:scale-90"
            onClick={() => {
              leaveRemovedThreadRoute();
              void threadActions
                .archive?.(routeThreadId)
                .catch((error) =>
                  console.error("[workbench] failed to archive conversation", error),
                );
            }}
          >
            <ArchiveIcon />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
