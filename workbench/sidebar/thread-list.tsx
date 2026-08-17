"use client";

import { ThreadListPrimitive, useAuiState } from "@assistant-ui/react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { WorkbenchThreadListItem } from "./thread-list-item";

function ThreadListLoading() {
  return (
    <div aria-label="正在加载会话" className="space-y-1 p-1">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-9 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function WorkbenchThreadList({ onNavigate }: { onNavigate?: () => void } = {}) {
  const isLoading = useAuiState((state) => state.threads.isLoading);
  const hasThreads = useAuiState((state) => state.threads.threadIds.length > 0);
  const hasMore = useAuiState((state) => state.threads.hasMore);

  return (
    <ThreadListPrimitive.Root className="flex min-h-0 flex-col">
      {isLoading ? <ThreadListLoading /> : null}

      {!isLoading && !hasThreads ? (
        <p className="text-muted-foreground px-2 py-4 text-xs leading-relaxed">
          发送第一条消息后，会话会显示在这里。
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
          显示更多
        </ThreadListPrimitive.LoadMore>
      ) : null}
    </ThreadListPrimitive.Root>
  );
}
