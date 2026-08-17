"use client";

import { PanelLeftCloseIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sidebar, useSidebar } from "@/components/ui/sidebar";
import { useI18n } from "@/i18n";
import { SlotHost } from "@/platform/extensions";
import { NewThreadButton } from "@/workbench/sidebar/new-thread-button";
import { SidebarResizeHandle } from "@/workbench/sidebar/sidebar-resize-handle";
import { WorkbenchThreadList } from "@/workbench/sidebar/thread-list";

export function WorkbenchSidebarContent({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!mobile ? (
        <div className="flex h-12 shrink-0 items-center gap-3 px-5">
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

      <nav aria-label={t("workbench.sidebar.mainNavigation")} className="shrink-0 px-4 pb-5">
        <NewThreadButton onNavigate={onNavigate} />
        {!mobile ? (
          <SlotHost name="sidebar.navigation" className="mt-2 flex flex-col gap-1 empty:hidden" />
        ) : null}
      </nav>

      <div className="flex h-9 shrink-0 items-center px-5">
        <h2 className="text-muted-foreground min-w-0 flex-1 text-base font-medium">
          {t("workbench.shell.workspace")}
        </h2>
        {!mobile ? (
          <SlotHost
            name="sidebar.workspace.actions"
            className="flex shrink-0 items-center gap-1 empty:hidden"
          />
        ) : null}
      </div>

      {!mobile ? (
        <SlotHost
          name="sidebar.top"
          className="flex shrink-0 flex-col gap-1 px-4 pb-1 empty:hidden"
        />
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1">
        <WorkbenchThreadList onNavigate={onNavigate} />
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
          className="flex min-h-14 shrink-0 items-center gap-2 px-4 py-3 empty:hidden"
        />
      ) : null}
    </div>
  );
}

function MobileSidebarHeader() {
  const { t } = useI18n();
  const { setOpenMobile } = useSidebar();

  return (
    <div className="flex h-14 shrink-0 items-center justify-between px-4">
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
  onResize(width: number): void;
  onResizingChange(resizing: boolean): void;
}

export function WorkbenchSidebar({
  width,
  minWidth,
  maxWidth,
  onResize,
  onResizingChange,
}: WorkbenchSidebarProps) {
  const { t } = useI18n();
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <Sidebar
      aria-label={t("workbench.sidebar.region")}
      closeLabel={t("workbench.sidebar.closeMobile")}
      mobileDescription={t("workbench.sidebar.mobileDescription")}
      mobileTitle={t("workbench.sidebar.mobileTitle")}
      collapsible="offcanvas"
    >
      <WorkbenchSidebarContent
        mobile={isMobile}
        onNavigate={isMobile ? () => setOpenMobile(false) : undefined}
      />
      {!isMobile ? (
        <SidebarResizeHandle
          width={width}
          minWidth={minWidth}
          maxWidth={maxWidth}
          onResize={onResize}
          onResizingChange={onResizingChange}
        />
      ) : null}
    </Sidebar>
  );
}
