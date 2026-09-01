"use client";

import { useAuiState } from "@assistant-ui/react";
import { ChevronRightIcon, FolderIcon, PanelLeftOpenIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Button } from "../ui/button";
import { useSidebar } from "../ui/sidebar";
import { useI18n } from "../i18n";
import { cn } from "../utils";
import { useMainViewService } from "@workbench/extension-host";
import { SlotHost } from "@workbench/extension-host/hosts/slot-host";
import { useWorkbenchAgentThreadSnapshot } from "@workbench/agent-runtime-client/context";
import { truncateConversationTitle } from "../conversation-title";
import { ConversationActionsMenu } from "./conversation-actions-menu";

function SidebarOpenButton() {
  const { t } = useI18n();
  const { isMobile, toggleSidebar } = useSidebar();

  if (!isMobile) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t("workbench.sidebar.openMobile")}
      title={t("workbench.sidebar.openMobile")}
      onClick={toggleSidebar}
    >
      <PanelLeftOpenIcon className="size-4" />
    </Button>
  );
}

interface ResolvedMainViewBreadcrumb {
  label: string;
  navigable: boolean;
}

function MainViewBreadcrumbs({
  items,
  label,
  onNavigate,
}: {
  items: readonly ResolvedMainViewBreadcrumb[];
  label: string;
  onNavigate(index: number): void;
}) {
  return (
    <nav className="min-w-0" aria-label={label} title={items.map((item) => item.label).join(" / ")}>
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li
              key={`${index}-${item.label}`}
              className={cn("flex min-w-0 items-center gap-1", !current && "shrink-0")}
            >
              {index > 0 ? (
                <ChevronRightIcon
                  aria-hidden="true"
                  className="text-muted-foreground/70 size-3.5 shrink-0"
                />
              ) : null}
              {current ? (
                <span className="text-foreground truncate font-semibold" aria-current="page">
                  {item.label}
                </span>
              ) : item.navigable ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground focus-visible:ring-ring -mx-1 max-w-32 min-w-0 px-1.5 font-medium focus-visible:ring-2"
                  onClick={() => onNavigate(index)}
                >
                  <span className="truncate">{item.label}</span>
                </Button>
              ) : (
                <span className="text-muted-foreground max-w-32 truncate font-medium">
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function WorkbenchHeader() {
  const { t, text } = useI18n();
  const { isMobile, state: sidebarState } = useSidebar();
  const mainViews = useMainViewService();
  const activeMainView = useSyncExternalStore(
    mainViews.subscribe,
    mainViews.getSnapshot,
    mainViews.getInitialSnapshot,
  );
  const currentThread = useAuiState((state) =>
    state.threads.threadItems.find((thread) => thread.id === state.threads.mainThreadId),
  );
  const managedThread = useWorkbenchAgentThreadSnapshot(
    currentThread?.remoteId ?? currentThread?.externalId ?? currentThread?.id,
  );
  const currentThreadTitle = managedThread.title ?? currentThread?.title;
  const currentWorkspace = managedThread.workspace;
  const currentWorkspaceName =
    currentWorkspace?.name ?? currentWorkspace?.rootPath ?? currentWorkspace?.id;
  const title = activeMainView
    ? text(activeMainView.title)
    : currentThreadTitle || t("workbench.sidebar.newThread");
  const breadcrumbs = activeMainView?.breadcrumbs?.map((item) => ({
    label: text(item.label),
    navigable: item.params !== undefined || item.closeView === true,
  }));
  const visibleTitle = activeMainView ? title : truncateConversationTitle(title);
  const desktopSidebarCollapsed = !isMobile && sidebarState === "collapsed";

  return (
    <header
      data-workbench-surface="header"
      className="bg-background grid h-10 shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1 border-b ps-2 [padding-inline-end:calc(var(--right-workspace-toggle-inset-end)_+_var(--right-workspace-toggle-reserved-width))] [app-region:drag] select-none sm:grid-cols-[1fr_auto_1fr] sm:gap-0 sm:ps-3 [&_a]:[app-region:no-drag] [&_button]:[app-region:no-drag]"
    >
      <div
        className={cn(
          "relative flex h-full min-w-0 items-center gap-1.5 transition-[padding-inline-start] duration-[240ms] ease-[cubic-bezier(0.45,0,0.8,0.7)] in-data-[resizing=true]:transition-none in-data-[sidebar-collapse-preview=true]:ps-[max(0px,calc(28px-var(--sidebar-width)))] motion-reduce:transition-none sm:gap-2 in-data-[sidebar-collapse-preview=true]:sm:ps-[max(0px,calc(24px-var(--sidebar-width)))]",
          desktopSidebarCollapsed && "ps-7 sm:ps-6",
        )}
      >
        <SidebarOpenButton />
        {breadcrumbs ? (
          <MainViewBreadcrumbs
            items={breadcrumbs}
            label={t("workbench.shell.mainViewBreadcrumbs")}
            onNavigate={mainViews.openBreadcrumb}
          />
        ) : (
          <span
            className="min-w-0 shrink truncate text-sm font-semibold"
            aria-label={title}
            title={title}
          >
            {visibleTitle}
          </span>
        )}
        {!activeMainView && currentWorkspaceName ? (
          <span
            data-slot="current-workspace"
            aria-label={t("workbench.shell.currentWorkspace", { name: currentWorkspaceName })}
            title={t("workbench.shell.currentWorkspace", {
              name: currentWorkspace?.rootPath ?? currentWorkspaceName,
            })}
            className="border-border/60 bg-muted/70 text-muted-foreground inline-flex h-[var(--button-height-default)] min-w-0 max-w-36 shrink items-center gap-1 overflow-hidden rounded-md border px-2 text-sm font-medium whitespace-nowrap sm:max-w-48"
          >
            <FolderIcon aria-hidden="true" className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{currentWorkspaceName}</span>
          </span>
        ) : null}
        {activeMainView?.chrome?.headerLeft !== "hidden" ? (
          <SlotHost name="header.left" className="flex shrink-0 items-center gap-1 sm:gap-2" />
        ) : null}
        {!activeMainView && currentThread?.status === "regular" ? (
          <ConversationActionsMenu
            threadId={currentThread.id}
            sessionId={currentThread.remoteId ?? currentThread.externalId ?? currentThread.id}
            title={currentThreadTitle}
          />
        ) : null}
      </div>

      <SlotHost
        name="header.center"
        className="flex min-w-0 items-center justify-center gap-1 sm:gap-2"
      />

      <div className="flex min-w-0 items-center justify-end">
        <SlotHost
          name="header.right"
          className="flex min-w-0 items-center justify-end gap-1 sm:gap-2"
        />
      </div>
    </header>
  );
}
