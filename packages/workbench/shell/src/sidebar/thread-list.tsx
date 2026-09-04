"use client";

import { useI18n } from "../i18n";
import { Skeleton } from "../ui/skeleton";
import { WorkbenchThreadListItem } from "./thread-list-item";
import { sidebarThreadScope, useWorkspaceSidebar } from "./workspace-sidebar-context";

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
  return (
    <div className="flex min-h-0 flex-col gap-0.5" data-sidebar-scope={scope}>
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
        threads.map(({ thread, workspaceId: ownerId }) => (
          <WorkbenchThreadListItem
            key={thread.threadId}
            thread={thread}
            workspaceId={ownerId}
            onNavigate={onNavigate}
          />
        ))
      )}
      {showEmpty && !loading && threads.length === 0 ? (
        <p className="text-muted-foreground px-2 py-2 text-xs">
          {t(query ? "workbench.sidebar.noSearchResults" : "workbench.sidebar.empty")}
        </p>
      ) : null}
    </div>
  );
}
