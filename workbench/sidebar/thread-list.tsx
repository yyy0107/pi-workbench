"use client";

import { ThreadListPrimitive, useAuiState } from "@assistant-ui/react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";

import { WorkbenchThreadListItem } from "./thread-list-item";

function ThreadListLoading() {
  const { t } = useI18n();

  return (
    <div aria-label={t("workbench.sidebar.loading")} className="space-y-1 p-1">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-9 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function WorkbenchThreadList({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { t } = useI18n();
  const isLoading = useAuiState((state) => state.threads.isLoading);
  const hasThreads = useAuiState((state) => state.threads.threadIds.length > 0);
  const hasMore = useAuiState((state) => state.threads.hasMore);

  return (
    <ThreadListPrimitive.Root className="flex min-h-0 flex-col">
      {isLoading ? <ThreadListLoading /> : null}

      {!isLoading && !hasThreads ? (
        <p className="text-muted-foreground px-2 py-4 text-xs leading-relaxed">
          {t("workbench.sidebar.empty")}
        </p>
      ) : null}

      {!isLoading ? (
        <ThreadListPrimitive.Items>
          {() => <WorkbenchThreadListItem onNavigate={onNavigate} />}
        </ThreadListPrimitive.Items>
      ) : null}

      {hasMore ? (
        <ThreadListPrimitive.LoadMore
          render={<Button type="button" variant="ghost" size="sm" className="mt-2 w-full" />}
        >
          {t("workbench.sidebar.loadMore")}
        </ThreadListPrimitive.LoadMore>
      ) : null}
    </ThreadListPrimitive.Root>
  );
}
