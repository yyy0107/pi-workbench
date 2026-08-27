"use client";

import { useAui, useAuiState } from "@assistant-ui/react";
import {
  ArrowDownAZIcon,
  ArchiveRestoreIcon,
  ChevronDownIcon,
  FolderIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuRadioGroup } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  SettingsDropdownContent,
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
} from "@/components/ui/settings-control";
import { useI18n } from "@/i18n";
import type { SettingsItemComponentProps } from "@/platform/extensions";
import { usePiThreadStates, usePiWorkspaces } from "@/runtime/pi/client/runtime/context";

const ALL_PROJECTS = "all-projects";
const UNGROUPED_PROJECT = "ungrouped-project";
const ARCHIVED_CHAT_PAGE_SIZE = 24;
const ARCHIVED_CHAT_SKELETON_COUNT = 4;

type SortOrder = "newest" | "oldest";

interface ArchivedChatView {
  id: string;
  title?: string;
  lastMessageAt?: Date;
  workspaceId?: string;
  workspaceName?: string;
  workspaceCwd?: string;
}

type DeleteTarget =
  | { kind: "all"; chats: readonly ArchivedChatView[] }
  | { kind: "chat"; chats: readonly [ArchivedChatView] };

function ArchivedChatRowsSkeleton({ label, count }: { label: string; count: number }) {
  return (
    <div role="status" aria-label={label} className="space-y-2">
      <span className="sr-only">{label}</span>
      <div className="bg-muted h-5 w-36 animate-pulse rounded-md" />
      <div className="divide-y overflow-hidden rounded-2xl border bg-background/50">
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="flex min-h-18 animate-pulse items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="bg-muted h-4 w-2/5 rounded-md" />
              <div className="bg-muted h-3 w-1/4 rounded-md" />
            </div>
            <div className="bg-muted size-8 rounded-lg" />
            <div className="bg-muted h-8 w-24 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ArchivedChatsSettingsItem({ sectionId, itemId }: SettingsItemComponentProps) {
  const { date: formatDate, locale, t } = useI18n();
  const aui = useAui();
  const workspaces = usePiWorkspaces();
  const archivedThreadIds = useAuiState((state) => state.threads.archivedThreadIds);
  const threadItems = useAuiState((state) => state.threads.threadItems);
  const isLoading = useAuiState((state) => state.threads.isLoading);
  const [query, setQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [workspaceFilter, setWorkspaceFilter] = useState(ALL_PROJECTS);
  const [busyThreadIds, setBusyThreadIds] = useState<ReadonlySet<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>();
  const [actionFailed, setActionFailed] = useState(false);
  const [visibleChatLimit, setVisibleChatLimit] = useState(ARCHIVED_CHAT_PAGE_SIZE);
  const [workspaceHeaderTop, setWorkspaceHeaderTop] = useState(0);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const stickyToolbarRef = useRef<HTMLDivElement>(null);
  const archivedRouteThreadIds = useMemo(() => {
    const itemsById = new Map(threadItems.map((thread) => [thread.id, thread]));
    return archivedThreadIds.flatMap((threadId) => {
      const thread = itemsById.get(threadId);
      return thread ? [thread.remoteId ?? thread.externalId ?? thread.id] : [];
    });
  }, [archivedThreadIds, threadItems]);
  const archivedThreadStates = usePiThreadStates(archivedRouteThreadIds);

  const archivedChats = useMemo<ArchivedChatView[]>(() => {
    const itemsById = new Map(threadItems.map((thread) => [thread.id, thread]));
    return archivedThreadIds.flatMap((threadId) => {
      const thread = itemsById.get(threadId);
      if (!thread) return [];
      const remoteId = thread.remoteId ?? thread.externalId ?? thread.id;
      const managedState = archivedThreadStates.get(remoteId);
      const workspace = managedState?.metadata.workspace;
      return [
        {
          id: thread.id,
          title: managedState?.thread?.title ?? thread.title,
          lastMessageAt: managedState?.thread?.lastMessageAt ?? thread.lastMessageAt,
          workspaceId: workspace?.id,
          workspaceName: workspace?.name,
          workspaceCwd: workspace?.cwd,
        },
      ];
    });
  }, [archivedThreadIds, archivedThreadStates, threadItems]);

  const workspaceOptions = useMemo(() => {
    const options = workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      cwd: workspace.cwd,
    }));
    const knownIds = new Set(options.map(({ id }) => id));
    for (const chat of archivedChats) {
      if (!chat.workspaceId || knownIds.has(chat.workspaceId)) continue;
      options.push({
        id: chat.workspaceId,
        name: chat.workspaceName ?? chat.workspaceId,
        cwd: chat.workspaceCwd ?? "",
      });
      knownIds.add(chat.workspaceId);
    }
    return options;
  }, [archivedChats, workspaces]);

  const hasUngroupedChats = archivedChats.some((chat) => !chat.workspaceId);
  const selectedWorkspaceLabel =
    workspaceFilter === ALL_PROJECTS
      ? t("extensions.archivedChats.allProjects")
      : workspaceFilter === UNGROUPED_PROJECT
        ? t("extensions.archivedChats.ungroupedProject")
        : (workspaceOptions.find(({ id }) => id === workspaceFilter)?.name ??
          t("extensions.archivedChats.allProjects"));

  const groupedChats = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    const visibleChats = archivedChats
      .filter((chat) => {
        if (workspaceFilter === UNGROUPED_PROJECT && chat.workspaceId) return false;
        if (
          workspaceFilter !== ALL_PROJECTS &&
          workspaceFilter !== UNGROUPED_PROJECT &&
          chat.workspaceId !== workspaceFilter
        ) {
          return false;
        }
        if (!normalizedQuery) return true;
        return [chat.title, chat.workspaceName, chat.workspaceCwd]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLocaleLowerCase(locale).includes(normalizedQuery));
      })
      .sort((left, right) => {
        const leftTime = left.lastMessageAt?.getTime() ?? 0;
        const rightTime = right.lastMessageAt?.getTime() ?? 0;
        return sortOrder === "newest" ? rightTime - leftTime : leftTime - rightTime;
      });

    const groups = new Map<string, { id: string; name: string; chats: ArchivedChatView[] }>();
    for (const chat of visibleChats) {
      const id = chat.workspaceId ?? UNGROUPED_PROJECT;
      const name = chat.workspaceName ?? t("extensions.archivedChats.ungroupedProject");
      const group = groups.get(id) ?? { id, name, chats: [] };
      group.chats.push(chat);
      groups.set(id, group);
    }

    const workspaceOrder = new Map(
      workspaceOptions.map((workspace, index) => [workspace.id, index]),
    );
    return [...groups.values()].sort(
      (left, right) =>
        (workspaceOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (workspaceOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [archivedChats, locale, query, sortOrder, t, workspaceFilter, workspaceOptions]);

  const visibleChatCount = groupedChats.reduce((count, group) => count + group.chats.length, 0);
  const visibleGroups = useMemo(() => {
    let remaining = visibleChatLimit;
    return groupedChats.flatMap((group) => {
      if (remaining <= 0) return [];
      const chats = group.chats.slice(0, remaining);
      remaining -= chats.length;
      return [{ ...group, chats, totalCount: group.chats.length }];
    });
  }, [groupedChats, visibleChatLimit]);
  const renderedChatCount = Math.min(visibleChatLimit, visibleChatCount);
  const hasMoreChats = renderedChatCount < visibleChatCount;

  useEffect(() => {
    const loadMoreElement = loadMoreRef.current;
    if (!loadMoreElement || !hasMoreChats) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisibleChatLimit((current) =>
          Math.min(current + ARCHIVED_CHAT_PAGE_SIZE, visibleChatCount),
        );
      },
      { rootMargin: "320px 0px" },
    );
    observer.observe(loadMoreElement);
    return () => observer.disconnect();
  }, [hasMoreChats, visibleChatCount]);

  useEffect(() => {
    const toolbar = stickyToolbarRef.current;
    if (!toolbar) return;

    const updateWorkspaceHeaderTop = () => {
      let scrollContainer = toolbar.parentElement;
      while (scrollContainer) {
        const overflowY = window.getComputedStyle(scrollContainer).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") break;
        scrollContainer = scrollContainer.parentElement;
      }

      const scrollPaddingTop = scrollContainer
        ? Number.parseFloat(window.getComputedStyle(scrollContainer).paddingTop) || 0
        : 0;
      setWorkspaceHeaderTop(
        Math.max(0, Math.ceil(toolbar.getBoundingClientRect().height - scrollPaddingTop)),
      );
    };

    updateWorkspaceHeaderTop();
    const observer = new ResizeObserver(updateWorkspaceHeaderTop);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  const resetVisibleChats = () => setVisibleChatLimit(ARCHIVED_CHAT_PAGE_SIZE);
  const setBusy = (threadIds: readonly string[], busy: boolean) => {
    setBusyThreadIds((current) => {
      const next = new Set(current);
      for (const threadId of threadIds) {
        if (busy) next.add(threadId);
        else next.delete(threadId);
      }
      return next;
    });
  };

  const unarchive = async (chat: ArchivedChatView) => {
    setActionFailed(false);
    setBusy([chat.id], true);
    try {
      await aui.threads.item({ id: chat.id }).unarchive();
    } catch (error) {
      console.error("[workbench] failed to unarchive conversation", error);
      setActionFailed(true);
    } finally {
      setBusy([chat.id], false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const chatIds = deleteTarget.chats.map(({ id }) => id);
    setActionFailed(false);
    setBusy(chatIds, true);
    let failed = false;
    for (const chat of deleteTarget.chats) {
      try {
        await aui.threads.item({ id: chat.id }).delete();
      } catch (error) {
        console.error("[workbench] failed to delete archived conversation", error);
        failed = true;
      }
    }
    setBusy(chatIds, false);
    setDeleteTarget(undefined);
    setActionFailed(failed);
  };

  return (
    <div data-settings-section={sectionId} data-settings-item={itemId} className="min-h-0 pb-4">
      <div
        ref={stickyToolbarRef}
        data-archived-chats-sticky-toolbar=""
        className="bg-background/95 sticky -top-5 z-20 -mx-5 -mt-3 mb-4 px-5 pt-3 backdrop-blur-sm sm:-mx-6 sm:px-6"
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="relative min-w-52 flex-1">
            <span className="sr-only">{t("extensions.archivedChats.searchLabel")}</span>
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-[var(--input-control-icon-size)] -translate-y-1/2" />
            <Input
              type="search"
              value={query}
              placeholder={t("extensions.archivedChats.searchPlaceholder")}
              className="pl-9"
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                resetVisibleChats();
              }}
            />
          </label>

          <DropdownMenu>
            <SettingsDropdownTrigger
              className="min-w-36 justify-between"
              aria-label={t("extensions.archivedChats.sortLabel")}
            >
              <ArrowDownAZIcon className="text-muted-foreground size-4" />
              <span className="min-w-0 flex-1 truncate text-start">
                {t(
                  sortOrder === "newest"
                    ? "extensions.archivedChats.newestFirst"
                    : "extensions.archivedChats.oldestFirst",
                )}
              </span>
              <ChevronDownIcon className="text-muted-foreground size-3.5" />
            </SettingsDropdownTrigger>
            <SettingsDropdownContent align="end" side="bottom">
              <DropdownMenuRadioGroup
                value={sortOrder}
                onValueChange={(value) => {
                  setSortOrder(value as SortOrder);
                  resetVisibleChats();
                }}
              >
                <SettingsDropdownRadioItem value="newest">
                  {t("extensions.archivedChats.newestFirst")}
                </SettingsDropdownRadioItem>
                <SettingsDropdownRadioItem value="oldest">
                  {t("extensions.archivedChats.oldestFirst")}
                </SettingsDropdownRadioItem>
              </DropdownMenuRadioGroup>
            </SettingsDropdownContent>
          </DropdownMenu>

          <DropdownMenu>
            <SettingsDropdownTrigger
              className="min-w-40 justify-between"
              aria-label={t("extensions.archivedChats.projectFilterLabel")}
            >
              <FolderIcon className="text-muted-foreground size-4" />
              <span className="min-w-0 flex-1 truncate text-start">{selectedWorkspaceLabel}</span>
              <ChevronDownIcon className="text-muted-foreground size-3.5" />
            </SettingsDropdownTrigger>
            <SettingsDropdownContent align="end" side="bottom" className="max-h-72">
              <DropdownMenuRadioGroup
                value={workspaceFilter}
                onValueChange={(value) => {
                  setWorkspaceFilter(value);
                  resetVisibleChats();
                }}
              >
                <SettingsDropdownRadioItem value={ALL_PROJECTS}>
                  {t("extensions.archivedChats.allProjects")}
                </SettingsDropdownRadioItem>
                {workspaceOptions.map((workspace) => (
                  <SettingsDropdownRadioItem key={workspace.id} value={workspace.id}>
                    <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                  </SettingsDropdownRadioItem>
                ))}
                {hasUngroupedChats ? (
                  <SettingsDropdownRadioItem value={UNGROUPED_PROJECT}>
                    {t("extensions.archivedChats.ungroupedProject")}
                  </SettingsDropdownRadioItem>
                ) : null}
              </DropdownMenuRadioGroup>
            </SettingsDropdownContent>
          </DropdownMenu>
        </div>

        <div className="flex min-h-8 items-center justify-between gap-3 border-b pb-3">
          <p className="text-muted-foreground text-xs">
            {t("extensions.archivedChats.totalCount", { count: visibleChatCount })}
          </p>
          {archivedChats.length > 0 ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busyThreadIds.size > 0}
              onClick={() => setDeleteTarget({ kind: "all", chats: archivedChats })}
            >
              <Trash2Icon className="size-3.5" />
              {t("extensions.archivedChats.deleteAll")}
            </Button>
          ) : null}
        </div>
      </div>

      {actionFailed ? (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {t("extensions.archivedChats.actionFailed")}
        </p>
      ) : null}

      {isLoading && archivedChats.length === 0 ? (
        <ArchivedChatRowsSkeleton
          label={t("extensions.archivedChats.loading")}
          count={ARCHIVED_CHAT_SKELETON_COUNT}
        />
      ) : archivedChats.length === 0 ? (
        <div className="text-muted-foreground rounded-2xl border border-dashed px-5 py-12 text-center text-sm">
          {t("extensions.archivedChats.empty")}
        </div>
      ) : visibleChatCount === 0 ? (
        <div className="text-muted-foreground rounded-2xl border border-dashed px-5 py-12 text-center text-sm">
          {t("extensions.archivedChats.noMatches")}
        </div>
      ) : (
        <div className="space-y-6">
          {visibleGroups.map((group) => (
            <section key={group.id} aria-labelledby={`archived-chat-group-${group.id}`}>
              <div
                data-archived-chats-workspace-header=""
                className="bg-background/95 sticky z-10 -mx-1 mb-2 flex items-center gap-2 border-b px-1 py-2 backdrop-blur-sm"
                style={{ top: workspaceHeaderTop }}
              >
                <FolderIcon className="text-muted-foreground size-4 shrink-0" />
                <h3
                  id={`archived-chat-group-${group.id}`}
                  className="min-w-0 flex-1 truncate text-sm font-medium"
                >
                  {group.name}
                </h3>
                <span className="text-muted-foreground text-xs">
                  {t("extensions.archivedChats.groupCount", { count: group.totalCount })}
                </span>
              </div>

              <div className="divide-y overflow-hidden rounded-2xl border bg-background/50">
                {group.chats.map((chat) => {
                  const busy = busyThreadIds.has(chat.id);
                  return (
                    <article key={chat.id} className="flex min-h-18 items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <h4 className="truncate text-sm font-medium">
                          {chat.title || t("extensions.archivedChats.untitled")}
                        </h4>
                        {chat.lastMessageAt ? (
                          <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                            {formatDate(chat.lastMessageAt, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        ) : null}
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("extensions.archivedChats.deleteChat", {
                          title: chat.title || t("extensions.archivedChats.untitled"),
                        })}
                        title={t("extensions.archivedChats.delete")}
                        disabled={busy}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget({ kind: "chat", chats: [chat] })}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void unarchive(chat)}
                      >
                        <ArchiveRestoreIcon className="size-3.5" />
                        {busy
                          ? t("extensions.archivedChats.working")
                          : t("extensions.archivedChats.unarchive")}
                      </Button>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
          {hasMoreChats ? (
            <div ref={loadMoreRef} className="pt-1">
              <ArchivedChatRowsSkeleton
                label={t("extensions.archivedChats.loadingMore")}
                count={ARCHIVED_CHAT_SKELETON_COUNT}
              />
            </div>
          ) : null}
        </div>
      )}

      <Dialog
        open={deleteTarget !== undefined}
        onOpenChange={(open) => {
          if (!open && busyThreadIds.size === 0) setDeleteTarget(undefined);
        }}
      >
        <DialogContent
          closeLabel={t("extensions.archivedChats.cancel")}
          showCloseButton={false}
          className="max-w-md gap-0 overflow-hidden rounded-3xl bg-popover p-0"
        >
          <DialogHeader className="gap-3 px-6 pt-6 pb-5">
            <DialogTitle className="text-lg leading-tight font-semibold">
              {t("extensions.archivedChats.deleteDialogTitle")}
            </DialogTitle>
            <DialogDescription className="leading-6">
              {deleteTarget?.kind === "all"
                ? t("extensions.archivedChats.deleteAllDescription", {
                    count: deleteTarget.chats.length,
                  })
                : t("extensions.archivedChats.deleteChatDescription", {
                    title: deleteTarget?.chats[0]?.title ?? t("extensions.archivedChats.untitled"),
                  })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-1 px-6 pb-6">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              disabled={busyThreadIds.size > 0}
              className="text-muted-foreground px-4 hover:bg-transparent hover:text-foreground focus-visible:border-transparent focus-visible:ring-0 focus-visible:underline focus-visible:underline-offset-4"
              onClick={() => setDeleteTarget(undefined)}
            >
              {t("extensions.archivedChats.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="lg"
              disabled={busyThreadIds.size > 0}
              className="rounded-xl px-5"
              onClick={() => void confirmDelete()}
            >
              {busyThreadIds.size > 0
                ? t("extensions.archivedChats.deleting")
                : t("extensions.archivedChats.confirmDelete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
