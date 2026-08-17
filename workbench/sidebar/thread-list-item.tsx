"use client";

import { ThreadListItemPrimitive, useAuiState } from "@assistant-ui/react";
import { ArchiveIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";

function formatRelativeTime(date: Date | undefined): string | undefined {
  if (!date) return undefined;

  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (elapsedMinutes < 1) return "刚刚";
  if (elapsedMinutes < 60) return `${elapsedMinutes} 分钟`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} 小时`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays} 天`;

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(date);
}

export function WorkbenchThreadListItem({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const isRunning = useAuiState((state) => state.threadListItem.isRunning);
  const lastMessageAt = useAuiState((state) => state.threadListItem.lastMessageAt);
  const isActive = useAuiState((state) => state.threads.mainThreadId === state.threadListItem.id);
  const routeThreadId = useAuiState(
    (state) =>
      state.threadListItem.remoteId ?? state.threadListItem.externalId ?? state.threadListItem.id,
  );
  const openThreadRoute = () => {
    router.push(`/c/${encodeURIComponent(routeThreadId)}`);
    onNavigate?.();
  };
  const leaveRemovedThreadRoute = () => {
    if (isActive) {
      router.replace("/");
      onNavigate?.();
    }
  };

  return (
    <ThreadListItemPrimitive.Root className="group hover:bg-sidebar-accent focus-within:bg-sidebar-accent data-active:bg-sidebar-accent relative flex min-h-9 items-center rounded-lg transition-colors">
      <ThreadListItemPrimitive.Trigger
        className="focus-visible:ring-sidebar-ring flex h-9 min-w-0 flex-1 items-center rounded-lg px-2.5 text-start text-sm outline-none focus-visible:ring-2"
        onClick={openThreadRoute}
      >
        {isRunning ? (
          <Loader2Icon className="text-muted-foreground me-2 size-3.5 shrink-0 animate-spin" />
        ) : null}
        <span className="min-w-0 flex-1 truncate">
          <ThreadListItemPrimitive.Title fallback="新对话" />
        </span>
        {!isRunning && lastMessageAt ? (
          <span className="text-muted-foreground ms-2 shrink-0 text-[11px] tabular-nums group-hover:opacity-0 group-focus-within:opacity-0 group-data-active:opacity-0">
            {formatRelativeTime(lastMessageAt)}
          </span>
        ) : null}
        {isRunning ? <span className="sr-only">Generating</span> : null}
      </ThreadListItemPrimitive.Trigger>

      <div className="bg-sidebar-accent absolute end-1 flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 group-data-active:opacity-100">
        <ThreadListItemPrimitive.Archive
          onClick={leaveRemovedThreadRoute}
          render={<TooltipIconButton tooltip="归档会话" side="right" className="size-7" />}
        >
          <ArchiveIcon className="size-3.5" />
        </ThreadListItemPrimitive.Archive>
        <ThreadListItemPrimitive.Delete
          onClick={leaveRemovedThreadRoute}
          render={
            <TooltipIconButton
              tooltip="删除会话"
              side="right"
              className="text-destructive hover:text-destructive size-7"
            />
          }
        >
          <Trash2Icon className="size-3.5" />
        </ThreadListItemPrimitive.Delete>
      </div>
    </ThreadListItemPrimitive.Root>
  );
}
