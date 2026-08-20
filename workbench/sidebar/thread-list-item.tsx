"use client";

import { ThreadListItemPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { ArchiveIcon, PinIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { ThinkingOrb } from "thinking-orbs";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { usePiThreadListItemState } from "@/runtime/pi/client/runtime/context";
import { conversationThreadIdFromPathname } from "@/workbench/workspaces/new-thread-policy";
import { useWorkspaceDirectoryStore } from "@/workbench/workspaces/workspace-directory-store";

export function WorkbenchThreadListItem({
  workspaceId,
  onNavigate,
}: {
  workspaceId?: string;
  onNavigate?: () => void;
}) {
  const { date: formatDate, relativeTime, t } = useI18n();
  const aui = useAui();
  const pathname = usePathname();
  const runtimeIsRunning = useAuiState((state) => state.threadListItem.isRunning);
  const runtimeTitle = useAuiState((state) => state.threadListItem.title);
  const runtimeLastMessageAt = useAuiState((state) => state.threadListItem.lastMessageAt);
  const isActive = useAuiState((state) => state.threads.mainThreadId === state.threadListItem.id);
  const isPinned = useAuiState((state) => state.threadListItem.custom?.piPinned === true);
  const threadCustom = useAuiState((state) => state.threadListItem.custom);
  const threadId = useAuiState((state) => state.threadListItem.id);
  const routeThreadId = useAuiState(
    (state) =>
      state.threadListItem.remoteId ?? state.threadListItem.externalId ?? state.threadListItem.id,
  );
  const piState = usePiThreadListItemState(routeThreadId);
  const hasEmptyNewThread = useAuiState(
    (state) =>
      state.threads.mainThreadId === state.threads.newThreadId &&
      state.thread.messages.length === 0,
  );
  const activateDirectory = useWorkspaceDirectoryStore((state) => state.activateDirectory);
  const deactivateDirectory = useWorkspaceDirectoryStore((state) => state.deactivateDirectory);
  const destroyNewThread = useWorkspaceDirectoryStore((state) => state.destroyNewThread);
  const isRunning = runtimeIsRunning || piState.running;
  const title = piState.thread?.title ?? runtimeTitle;
  const lastMessageAt = piState.thread?.lastMessageAt ?? runtimeLastMessageAt;
  const openThreadRoute = () => {
    destroyNewThread();
    if (hasEmptyNewThread) {
      void aui.thread
        .composer()
        .reset()
        .catch((error) => console.error("[workbench] failed to discard empty conversation", error));
    }
    if (workspaceId) activateDirectory(workspaceId);
    else deactivateDirectory();
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
    try {
      await aui.threads.item({ id: threadId }).updateCustom({
        ...threadCustom,
        piPinned: !isPinned,
      });
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
      className="group/thread text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-within:bg-sidebar-accent focus-within:text-sidebar-foreground data-active:text-sidebar-foreground relative -ms-6 flex min-h-9 items-center rounded-lg transition-colors"
    >
      {isRunning ? (
        <ThinkingOrb
          state="working"
          size={20}
          aria-hidden="true"
          className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2"
        />
      ) : null}
      <ThreadListItemPrimitive.Trigger
        className="focus-visible:ring-sidebar-ring flex h-9 min-w-0 flex-1 items-center rounded-lg pe-2.5 ps-[34px] text-start text-sm outline-none focus-visible:ring-2"
        onClick={openThreadRoute}
      >
        <span className="min-w-0 flex-1 truncate group-hover/thread:pe-14 group-has-[:focus-visible]/thread:pe-14">
          {title || t("workbench.sidebar.newThread")}
        </span>
        {!isRunning && piState.completed ? (
          <>
            <span
              aria-hidden="true"
              className="bg-primary ms-2 size-2 shrink-0 rounded-full group-hover/thread:hidden group-has-[:focus-visible]/thread:hidden"
            />
            <span className="sr-only">{t("workbench.sidebar.completed")}</span>
          </>
        ) : !isRunning && lastMessageAt ? (
          <span className="text-muted-foreground ms-2 shrink-0 text-[11px] tabular-nums group-hover/thread:hidden group-has-[:focus-visible]/thread:hidden">
            {formattedTime}
          </span>
        ) : null}
        {isRunning ? <span className="sr-only">{t("workbench.sidebar.generating")}</span> : null}
      </ThreadListItemPrimitive.Trigger>

      <div className="pointer-events-none absolute end-0 flex items-center opacity-0 transition-opacity group-hover/thread:pointer-events-auto group-hover/thread:opacity-100 group-has-[:focus-visible]/thread:pointer-events-auto group-has-[:focus-visible]/thread:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t(isPinned ? "workbench.sidebar.unpin" : "workbench.sidebar.pin")}
          aria-pressed={isPinned}
          title={t(isPinned ? "workbench.sidebar.unpin" : "workbench.sidebar.pin")}
          className={cn(
            "aui-button-icon text-muted-foreground hover:text-foreground size-7 p-1 active:scale-90",
            isPinned && "text-foreground",
          )}
          onClick={() => void togglePinned()}
        >
          <PinIcon className="size-[18px]" />
        </Button>
        <ThreadListItemPrimitive.Archive
          onClick={leaveRemovedThreadRoute}
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("workbench.sidebar.archive")}
              title={t("workbench.sidebar.archive")}
              className="aui-button-icon text-muted-foreground hover:text-foreground size-7 p-1 active:scale-90"
            />
          }
        >
          <ArchiveIcon className="size-[18px]" />
        </ThreadListItemPrimitive.Archive>
      </div>
    </ThreadListItemPrimitive.Root>
  );
}
