"use client";

import { useState } from "react";
import { ArchiveIcon, Clock3Icon, MoreHorizontalIcon, PinIcon, PinOffIcon } from "lucide-react";
import type { ThreadListItem } from "@workbench/agent-runtime-client";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { SidebarActions, SidebarRow, SidebarStatus } from "../ui/sidebar-items";
import { useI18n } from "../i18n";
import { useAppearancePreferences } from "../appearance";
import { useWorkbenchNavigation } from "../navigation";
import { RunningThreadIndicator } from "./running-thread-indicator";
import {
  SidebarMoveMenuItems,
  sidebarThreadKey,
  useWorkspaceSidebar,
  useWorkspaceSidebarItem,
} from "./workspace-sidebar-context";

export function WorkbenchThreadListItem({
  thread,
  workspaceId,
  onNavigate,
}: {
  thread: ThreadListItem;
  workspaceId?: string;
  onNavigate?: () => void;
}) {
  const { date: formatDate, relativeTime, t } = useI18n();
  const { runningIndicatorId } = useAppearancePreferences();
  const sidebar = useWorkspaceSidebar();
  const controls = useWorkspaceSidebarItem(sidebarThreadKey(thread.threadId));
  const navigation = useWorkbenchNavigation();
  const [menuOpen, setMenuOpen] = useState(false);
  const threadActions = sidebar.runtime.threadActions;
  const isActive = sidebar.current.threadId === thread.threadId;
  const waiting = !isActive && thread.isWaitingForInput;
  const automation = thread.origin?.kind === "automation";
  const lastMessageAt = thread.updatedAt ? new Date(thread.updatedAt) : undefined;
  const formattedTime = (() => {
    if (!lastMessageAt) return undefined;
    const minutes = Math.max(0, Math.floor((Date.now() - lastMessageAt.getTime()) / 60_000));
    if (minutes < 1) return relativeTime(0, "minute");
    if (minutes < 60) return relativeTime(-minutes, "minute");
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return relativeTime(-hours, "hour");
    const days = Math.floor(hours / 24);
    if (days < 7) return relativeTime(-days, "day");
    return formatDate(lastMessageAt, { month: "numeric", day: "numeric" });
  })();
  const archive = () => {
    if (isActive || navigation.currentConversationId === thread.threadId) {
      navigation.openHome({ replace: true });
      onNavigate?.();
    }
    void threadActions
      .archive?.(thread.threadId)
      .catch((error) => console.error("[workbench] failed to archive conversation", error));
  };
  const pinLabel = t(thread.isPinned ? "workbench.sidebar.unpin" : "workbench.sidebar.pin");

  return (
    <SidebarRow
      label={thread.title || t("workbench.sidebar.newThread")}
      active={isActive}
      drag={controls.drag}
      menuOpen={menuOpen}
      data-thread-id={thread.threadId}
      icon={
        thread.isRunning && runningIndicatorId !== "none" ? (
          <RunningThreadIndicator id={runningIndicatorId} />
        ) : automation ? (
          <Clock3Icon />
        ) : undefined
      }
      description={
        <>
          {automation ? <span>{t("workbench.sidebar.automationTask")} </span> : null}
          {thread.isRunning ? t("workbench.sidebar.generating") : null}
        </>
      }
      status={
        waiting ? (
          <SidebarStatus className="text-warning">
            {t("workbench.sidebar.waitingForUserInput")}
          </SidebarStatus>
        ) : !thread.isRunning && thread.hasUnreadCompletion ? (
          <SidebarStatus>
            <span aria-hidden="true" className="sidebar-status-dot" />
            <span className="sr-only">{t("workbench.sidebar.completed")}</span>
          </SidebarStatus>
        ) : !thread.isRunning && lastMessageAt ? (
          <SidebarStatus secondary>{formattedTime}</SidebarStatus>
        ) : undefined
      }
      onActivate={() => {
        sidebar.capabilities.destroyNewThread();
        if (!thread.isPinned) {
          if (workspaceId) sidebar.capabilities.activateWorkspace(workspaceId);
          else sidebar.capabilities.deactivateWorkspace();
        }
        if (navigation.currentConversationId !== thread.threadId)
          navigation.openConversation(thread.threadId);
        onNavigate?.();
      }}
      actions={
        <SidebarActions
          desktop={
            <>
              {threadActions.setPinned ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={sidebar.dragState.pending}
                  aria-label={pinLabel}
                  title={pinLabel}
                  aria-pressed={thread.isPinned}
                  onClick={controls.togglePinned}
                >
                  {thread.isPinned ? <PinOffIcon /> : <PinIcon />}
                </Button>
              ) : null}
              {threadActions.archive ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={sidebar.dragState.pending}
                  aria-label={t("workbench.sidebar.archive")}
                  title={t("workbench.sidebar.archive")}
                  onClick={archive}
                >
                  <ArchiveIcon />
                </Button>
              ) : null}
            </>
          }
        >
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={sidebar.dragState.pending}
                  aria-label={t("workbench.sidebar.conversationOptions")}
                />
              }
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="sidebar-menu w-max">
              {threadActions.setPinned ? (
                <DropdownMenuItem onClick={controls.togglePinned}>
                  {thread.isPinned ? <PinOffIcon /> : <PinIcon />}
                  {pinLabel}
                </DropdownMenuItem>
              ) : null}
              <SidebarMoveMenuItems controls={controls} />
              {threadActions.archive ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={archive}>
                    <ArchiveIcon />
                    {t("workbench.sidebar.archive")}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarActions>
      }
    />
  );
}
