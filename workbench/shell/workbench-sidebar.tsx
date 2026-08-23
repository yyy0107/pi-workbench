"use client";

import { useId, useState, type ReactNode, type RefObject } from "react";
import { useAuiState } from "@assistant-ui/react";
import { ChevronRightIcon, PanelLeftCloseIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sidebar, useSidebar } from "@/components/ui/sidebar";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { SlotHost } from "@/platform/extensions";
import { SidebarResizeHandle } from "@/workbench/sidebar/sidebar-resize-handle";
import {
  WorkbenchPinnedThreadList,
  WorkbenchWorkspaceThreadList,
} from "@/workbench/sidebar/workspace-thread-list";
import { useWorkspaceDirectoryStore } from "@/workbench/workspaces/workspace-directory-store";

export function WorkbenchSidebarContent({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const hasPinnedThreads = useAuiState((state) =>
    state.threads.threadIds.some((threadId) => {
      const thread = state.threads.threadItems.find((item) => item.id === threadId);
      return thread?.custom?.piPinned === true;
    }),
  );
  const hasPinnedDirectories = useWorkspaceDirectoryStore(
    (state) => state.pinnedDirectoryIds.length > 0,
  );
  const [pinnedExpanded, setPinnedExpanded] = useState(true);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(true);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!mobile ? (
        <div className="flex h-10 shrink-0 items-center gap-3 ps-5 pe-2">
          <SlotHost
            name="sidebar.brand"
            className="flex min-w-0 flex-1 items-center empty:hidden"
          />
          <SidebarCollapseButton />
        </div>
      ) : (
        <MobileSidebarHeader />
      )}

      {!mobile ? (
        <SlotHost
          name="sidebar.header"
          className="flex shrink-0 items-center gap-1 px-4 empty:hidden"
        />
      ) : null}

      {!mobile ? (
        <SlotHost
          name="sidebar.navigation"
          className="mx-4 mb-5 flex shrink-0 flex-col gap-1 empty:hidden"
        />
      ) : null}

      <div
        data-workspace-scroll-container
        className="min-h-0 flex-1 overflow-y-auto py-1 ps-3 pe-[2px] [scrollbar-gutter:stable] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-[6px]"
      >
        {hasPinnedThreads || hasPinnedDirectories ? (
          <section className="mb-1 flex flex-col gap-0.5">
            <SidebarSectionHeading
              label={t("workbench.sidebar.pinned")}
              expanded={pinnedExpanded}
              onToggle={() => setPinnedExpanded((value) => !value)}
            />
            {pinnedExpanded ? <WorkbenchPinnedThreadList onNavigate={onNavigate} /> : null}
          </section>
        ) : null}

        <section className="flex flex-col gap-0.5">
          <SidebarSectionHeading
            label={t("workbench.shell.workspace")}
            expanded={workspaceExpanded}
            onToggle={() => setWorkspaceExpanded((value) => !value)}
            actions={
              <SlotHost
                name="sidebar.workspace.actions"
                className="flex shrink-0 items-center gap-1 empty:hidden"
              />
            }
          />

          {workspaceExpanded ? (
            <>
              {!mobile ? (
                <SlotHost name="sidebar.top" className="mb-1 flex flex-col gap-1 empty:hidden" />
              ) : null}
              <WorkbenchWorkspaceThreadList onNavigate={onNavigate} />
            </>
          ) : null}
        </section>
      </div>

      {!mobile ? (
        <SlotHost
          name="sidebar.bottom"
          className="flex shrink-0 flex-col gap-2 px-3 empty:hidden"
        />
      ) : null}

      {!mobile ? (
        <SlotHost
          name="sidebar.footer"
          className="flex min-h-12 shrink-0 items-center gap-2 px-4 pt-2 pb-1 empty:hidden"
        />
      ) : null}
    </div>
  );
}

function SidebarSectionHeading({
  label,
  expanded,
  onToggle,
  actions,
}: {
  label: string;
  expanded: boolean;
  onToggle(): void;
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  const labelId = useId();
  const actionId = useId();
  const actionLabel = t(
    expanded ? "workbench.sidebar.collapseSection" : "workbench.sidebar.expandSection",
  );

  return (
    <div
      data-workbench-selection-surface=""
      className="group/sidebar-section hover:bg-sidebar-accent focus-within:bg-sidebar-accent relative flex h-9 w-full shrink-0 items-center rounded-lg ps-2 pe-1 transition-colors"
    >
      <button
        type="button"
        aria-labelledby={`${labelId} ${actionId}`}
        aria-expanded={expanded}
        className="focus-visible:ring-sidebar-ring absolute inset-0 rounded-lg outline-none focus-visible:ring-2"
        onClick={onToggle}
      />
      <h2
        id={labelId}
        className="text-muted-foreground pointer-events-none min-w-0 flex-1 text-base font-medium"
      >
        {label}
      </h2>
      <div className="pointer-events-none flex size-7 shrink-0 items-center justify-center">
        <ChevronRightIcon
          className={cn(
            "size-4 opacity-100 transition-[transform,opacity] md:opacity-0 md:group-hover/sidebar-section:opacity-100 md:group-focus-within/sidebar-section:opacity-100",
            expanded && "rotate-90",
          )}
        />
      </div>
      {actions ? <div className="relative z-10 flex shrink-0 items-center">{actions}</div> : null}
      <span id={actionId} className="sr-only">
        {actionLabel}
      </span>
    </div>
  );
}

function MobileSidebarHeader() {
  const { t } = useI18n();
  const { setOpenMobile } = useSidebar();

  return (
    <div className="flex h-14 shrink-0 items-center justify-between ps-4 pe-2">
      <span className="text-sm font-semibold">{t("workbench.sidebar.conversations")}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("workbench.sidebar.closeMobile")}
        title={t("workbench.sidebar.closeMobile")}
        onClick={() => setOpenMobile(false)}
      >
        <PanelLeftCloseIcon className="size-[18px]" />
      </Button>
    </div>
  );
}

function SidebarCollapseButton() {
  const { t } = useI18n();
  const { setOpen } = useSidebar();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={t("workbench.sidebar.collapse")}
      title={t("workbench.sidebar.collapse")}
      onClick={() => setOpen(false)}
      className="text-muted-foreground hover:text-foreground"
    >
      <PanelLeftCloseIcon className="size-[18px]" />
    </Button>
  );
}

export interface WorkbenchSidebarProps {
  width: number;
  minWidth: number;
  maxWidth: number;
  shellRef: RefObject<HTMLElement | null>;
  onResize(width: number): void;
}

export function WorkbenchSidebar({
  width,
  minWidth,
  maxWidth,
  shellRef,
  onResize,
}: WorkbenchSidebarProps) {
  const { t } = useI18n();
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <Sidebar
      data-workbench-surface="sidebar"
      aria-label={t("workbench.sidebar.region")}
      closeLabel={t("workbench.sidebar.closeMobile")}
      mobileDescription={t("workbench.sidebar.mobileDescription")}
      mobileTitle={t("workbench.sidebar.mobileTitle")}
      collapsible="offcanvas"
    >
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <WorkbenchSidebarContent
          mobile={isMobile}
          onNavigate={isMobile ? () => setOpenMobile(false) : undefined}
        />
      </div>
      {!isMobile ? (
        <SidebarResizeHandle
          width={width}
          minWidth={minWidth}
          maxWidth={maxWidth}
          shellRef={shellRef}
          onResize={onResize}
        />
      ) : null}
    </Sidebar>
  );
}
