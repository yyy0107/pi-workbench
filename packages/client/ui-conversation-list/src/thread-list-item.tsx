"use client";
import { sidebarTranslationBundle as sharedSidebarTranslationBundle } from "@workbench/ui-sidebar/i18n";

import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import { ArchiveIcon, Clock3Icon, PinIcon, PinOffIcon } from "lucide-react";
import type { ThreadListItem } from "@workbench/agent-runtime-client";
import { Button } from "@workbench/ui";
import { SidebarActions, SidebarRow, SidebarStatus } from "@workbench/ui-sidebar/primitives";
import { useTranslationBundle } from "@workbench/i18n";
import { sidebarTranslationBundle } from "./i18n";
import { useAppearancePreferences } from "@workbench/appearance";
import { RunningThreadIndicator } from "./running-thread-indicator";
import { sidebarThreadKey } from "./sidebar-move";
import { useWorkspaceSidebar } from "./sidebar-context";
import { useWorkspaceSidebarItem } from "./workspace-sidebar-item";

export const WorkbenchThreadListItem = memo(function WorkbenchThreadListItem({
  thread,
  workspaceId,
  onNavigate,
}: {
  thread: ThreadListItem;
  workspaceId?: string;
  onNavigate?: () => void;
}) {
  const { date: formatDate, relativeTime, t } = useTranslationBundle(sidebarTranslationBundle);
  const { t: sharedT } = useTranslationBundle(sharedSidebarTranslationBundle);
  const { runningIndicatorId } = useAppearancePreferences();
  const sidebar = useWorkspaceSidebar(
    useShallow((state) => ({
      threadActions: state.threadActions,
      switchToNewThread: state.switchToNewThread,
      workspaceActions: state.workspaceActions,
      pending: state.dragState.pending,
      isActive: state.activeThreadId === thread.threadId,
      isRouteActive: state.navigation.currentConversationId === thread.threadId,
      openHome: state.navigation.openHome,
      openConversation: state.navigation.openConversation,
    })),
  );
  const controls = useWorkspaceSidebarItem(sidebarThreadKey(thread.threadId));
  const threadActions = sidebar.threadActions;
  const { isActive } = sidebar;
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
    if (isActive || sidebar.isRouteActive) {
      sidebar.openHome({ replace: true });
      onNavigate?.();
    }
    void threadActions
      .archive?.(thread.threadId)
      .catch((error) => console.error("[workbench] failed to archive conversation", error));
  };
  const pinLabel = t(thread.isPinned ? "workbench.sidebar.unpin" : "workbench.sidebar.pin");

  return (
    <SidebarRow
      label={thread.title || sharedT("workbench.sidebar.newThread")}
      active={isActive}
      drag={controls.drag}
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
        sidebar.workspaceActions.destroyNewThread();
        if (!thread.isPinned) {
          if (workspaceId) sidebar.workspaceActions.activateWorkspace(workspaceId);
          else sidebar.workspaceActions.deactivateWorkspace();
        }
        if (!sidebar.isRouteActive) sidebar.openConversation(thread.threadId);
        onNavigate?.();
      }}
      actions={
        threadActions.setPinned || threadActions.archive ? (
          <SidebarActions>
            {threadActions.setPinned ? (
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={sidebar.pending}
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
                disabled={sidebar.pending}
                aria-label={t("workbench.sidebar.archive")}
                title={t("workbench.sidebar.archive")}
                onClick={archive}
              >
                <ArchiveIcon />
              </Button>
            ) : null}
          </SidebarActions>
        ) : undefined
      }
    />
  );
});
