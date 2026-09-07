"use client";

import { useState } from "react";
import { useI18n } from "../i18n";
import { SidebarRow } from "../ui/sidebar-items";
import { Skeleton } from "../ui/skeleton";
import { WorkbenchThreadListItem } from "./thread-list-item";
import { sidebarThreadScope, useWorkspaceSidebar } from "./workspace-sidebar-context";

const THREAD_PAGE_SIZE = 5;

export function WorkbenchThreadList({
  workspaceId,
  pinnedOnly = false,
  showEmpty = true,
  onNavigate,
}: {
  workspaceId?: string;
  pinnedOnly?: boolean;
  showEmpty?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const sidebar = useWorkspaceSidebar();
  const [visibleCount, setVisibleCount] = useState(THREAD_PAGE_SIZE);
  const collapsed = Boolean(
    workspaceId && sidebar.selection.collapsedWorkspaceIds.includes(workspaceId),
  );
  const [wasCollapsed, setWasCollapsed] = useState(collapsed);
  if (wasCollapsed !== collapsed) {
    setWasCollapsed(collapsed);
    // Preserve closing content, then reset before the reopened panel measures its height.
    if (!collapsed) setVisibleCount(THREAD_PAGE_SIZE);
  }
  const scope = pinnedOnly ? "threads:pinned" : sidebarThreadScope(workspaceId);
  const query = sidebar.searchQuery.trim().toLocaleLowerCase();
  const threads = (sidebar.model.orders.get(scope) ?? []).flatMap((key) => {
    const item = sidebar.model.items.get(key);
    if (item?.kind !== "thread") return [];
    const thread = sidebar.threadsById.get(item.id);
    return thread && (!query || thread.title?.toLocaleLowerCase().includes(query))
      ? [{ thread, workspaceId: item.workspaceId }]
      : [];
  });
  const loading = sidebar.isLoading && sidebar.threadsById.size === 0;
  const threadLimit = workspaceId ? visibleCount : threads.length;
  return (
    <div className="flex min-h-0 flex-col gap-(--sidebar-list-gap)" data-sidebar-scope={scope}>
      {loading ? (
        <div aria-label={t("workbench.sidebar.loading")}>
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton
              key={index}
              className="h-[var(--sidebar-row-height)] w-full rounded-[var(--sidebar-row-radius)]"
            />
          ))}
        </div>
      ) : (
        threads
          .slice(0, threadLimit)
          .map(({ thread, workspaceId: ownerId }) => (
            <WorkbenchThreadListItem
              key={thread.threadId}
              thread={thread}
              workspaceId={ownerId}
              onNavigate={onNavigate}
            />
          ))
      )}
      {!loading && threads.length > threadLimit ? (
        <SidebarRow
          className="[&>.sidebar-row-label]:text-muted-foreground"
          label={t("workbench.sidebar.loadMore")}
          onActivate={() => setVisibleCount((count) => count + THREAD_PAGE_SIZE)}
        />
      ) : null}
      {showEmpty && !loading && threads.length === 0 ? (
        <p className="text-muted-foreground px-2 py-2 text-xs">
          {t(query ? "workbench.sidebar.noSearchResults" : "workbench.sidebar.empty")}
        </p>
      ) : null}
    </div>
  );
}
