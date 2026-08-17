"use client";

import { ThreadListPrimitive, useAuiState } from "@assistant-ui/react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";

import { WorkbenchThreadListItem } from "./thread-list-item";

function ThreadListLoading() {
  const { t } = useI18n();

  return (
    <div aria-label={t("workbench.sidebar.loading")} className="flex flex-col gap-[2px] p-1">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-9 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function WorkbenchThreadList({
  workspaceId,
  onNavigate,
  showLoadMore = false,
  showEmpty = true,
}: {
  workspaceId: string;
  onNavigate?: () => void;
  showLoadMore?: boolean;
  showEmpty?: boolean;
}) {
  const { t } = useI18n();
  const isLoading = useAuiState((state) => state.threads.isLoading);
  const hasThreads = useAuiState((state) =>
    state.threads.threadIds.some((threadId) => {
      const thread = state.threads.threadItems.find((item) => item.id === threadId);
      return thread?.custom?.piWorkspaceId === workspaceId;
    }),
  );
  const hasMore = useAuiState((state) => state.threads.hasMore);

  return (
    <ThreadListPrimitive.Root className="flex min-h-0 flex-col gap-[2px]">
      {isLoading ? <ThreadListLoading /> : null}

      {!isLoading ? (
        <ThreadListPrimitive.Items>
          {({ threadListItem }) => {
            const threadWorkspaceId = threadListItem.custom?.piWorkspaceId;
            if (threadWorkspaceId !== workspaceId) return null;

            return <WorkbenchThreadListItem workspaceId={workspaceId} onNavigate={onNavigate} />;
          }}
        </ThreadListPrimitive.Items>
      ) : null}

      {showEmpty && !isLoading && !hasThreads ? (
        <p className="text-muted-foreground px-2 py-2 text-xs leading-relaxed">
          {t("workbench.sidebar.empty")}
        </p>
      ) : null}

      {showLoadMore && hasMore ? (
        <ThreadListPrimitive.LoadMore
          render={<Button type="button" variant="ghost" size="sm" className="mt-2 w-full" />}
        >
          {t("workbench.sidebar.loadMore")}
        </ThreadListPrimitive.LoadMore>
      ) : null}
    </ThreadListPrimitive.Root>
  );
}
