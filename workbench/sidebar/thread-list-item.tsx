"use client";

import { ThreadListItemPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { ArchiveIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { ThinkingOrb } from "thinking-orbs";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { usePiThreadActivity } from "@/runtime/pi/client/context";
import { useWorkspaceDirectoryStore } from "@/workbench/workspaces/workspace-directory-store";

export function WorkbenchThreadListItem({
  workspaceId,
  onNavigate,
}: {
  workspaceId: string;
  onNavigate?: () => void;
}) {
  const { date: formatDate, relativeTime, t } = useI18n();
  const aui = useAui();
  const router = useRouter();
  const runtimeIsRunning = useAuiState((state) => state.threadListItem.isRunning);
  const lastMessageAt = useAuiState((state) => state.threadListItem.lastMessageAt);
  const isActive = useAuiState((state) => state.threads.mainThreadId === state.threadListItem.id);
  const routeThreadId = useAuiState(
    (state) =>
      state.threadListItem.remoteId ?? state.threadListItem.externalId ?? state.threadListItem.id,
  );
  const hasEmptyNewThread = useAuiState(
    (state) =>
      state.threads.mainThreadId === state.threads.newThreadId &&
      state.thread.messages.length === 0,
  );
  const piActivity = usePiThreadActivity(routeThreadId);
  const activateDirectory = useWorkspaceDirectoryStore((state) => state.activateDirectory);
  const destroyNewThread = useWorkspaceDirectoryStore((state) => state.destroyNewThread);
  const isRunning = runtimeIsRunning || piActivity.running;
  const openThreadRoute = () => {
    destroyNewThread();
    if (hasEmptyNewThread) {
      void aui.thread
        .composer()
        .reset()
        .catch((error) => console.error("[workbench] failed to discard empty conversation", error));
    }
    activateDirectory(workspaceId);
    router.push(`/c/${encodeURIComponent(routeThreadId)}`);
    onNavigate?.();
  };
  const leaveRemovedThreadRoute = () => {
    if (isActive) {
      router.replace("/");
      onNavigate?.();
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
    <ThreadListItemPrimitive.Root className="group/thread hover:bg-sidebar-accent focus-within:bg-sidebar-accent data-active:bg-sidebar-accent relative -ms-6 flex min-h-9 items-center rounded-lg transition-colors">
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
          <ThreadListItemPrimitive.Title fallback={t("workbench.sidebar.newThread")} />
        </span>
        {!isRunning && piActivity.completed ? (
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

      <div className="bg-sidebar-accent absolute -end-[7px] flex items-center opacity-0 transition-opacity group-hover/thread:opacity-100 group-has-[:focus-visible]/thread:opacity-100">
        <ThreadListItemPrimitive.Archive
          onClick={leaveRemovedThreadRoute}
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("workbench.sidebar.archive")}
              className="aui-button-icon size-7 p-1 active:scale-90"
            />
          }
        >
          <ArchiveIcon className="size-[18px]" />
        </ThreadListItemPrimitive.Archive>
        <ThreadListItemPrimitive.Delete
          onClick={leaveRemovedThreadRoute}
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("workbench.sidebar.delete")}
              className="aui-button-icon text-destructive hover:text-destructive size-7 p-1 active:scale-90"
            />
          }
        >
          <Trash2Icon className="size-[18px]" />
        </ThreadListItemPrimitive.Delete>
      </div>
    </ThreadListItemPrimitive.Root>
  );
}
