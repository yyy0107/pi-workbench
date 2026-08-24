"use client";

import { useAuiState } from "@assistant-ui/react";
import { PanelLeftOpenIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { useRightWorkspaceState } from "@/components/right-workspace";
import { useSidebar } from "@/components/ui/sidebar";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { SlotHost, useMainViewService } from "@/platform/extensions";
import { usePiThreadListItemSnapshot } from "@/runtime/pi/client/runtime/context";

function SidebarOpenButton() {
  const { t } = useI18n();
  const { isMobile, state, toggleSidebar } = useSidebar();

  if (!isMobile && state === "expanded") return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={isMobile ? t("workbench.sidebar.openMobile") : t("workbench.sidebar.expand")}
      title={isMobile ? t("workbench.sidebar.openMobile") : t("workbench.sidebar.expand")}
      onClick={toggleSidebar}
    >
      <PanelLeftOpenIcon className="size-4" />
    </Button>
  );
}

export function WorkbenchHeader() {
  const { t, text } = useI18n();
  const mainViews = useMainViewService();
  const activeMainView = useSyncExternalStore(
    mainViews.subscribe,
    mainViews.getSnapshot,
    mainViews.getInitialSnapshot,
  );
  const workspaceOpen = useRightWorkspaceState((state) => state.open);
  const currentThread = useAuiState((state) =>
    state.threads.threadItems.find((thread) => thread.id === state.threads.mainThreadId),
  );
  const managedThread = usePiThreadListItemSnapshot(
    currentThread?.remoteId ?? currentThread?.externalId ?? currentThread?.id,
  );
  const currentThreadTitle = managedThread?.title ?? currentThread?.title;
  const title = activeMainView
    ? text(activeMainView.title)
    : currentThreadTitle || t("workbench.sidebar.newThread");

  return (
    <header
      data-workbench-surface="header"
      className={cn(
        "bg-background grid h-10 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b ps-3 [app-region:drag] select-none [&_a]:[app-region:no-drag] [&_[data-slot=button]]:[app-region:no-drag]",
        workspaceOpen
          ? "pe-3"
          : "[padding-inline-end:calc(var(--right-workspace-toggle-closed-inset-end)_+_var(--right-workspace-toggle-reserved-width))]",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <SidebarOpenButton />
        <span className="truncate text-sm font-semibold">{title}</span>
        <SlotHost name="header.left" className="flex items-center gap-2" />
      </div>

      <SlotHost name="header.center" className="flex items-center justify-center gap-2" />

      <div className="flex min-w-0 items-center justify-end gap-2">
        <SlotHost name="header.right" className="flex min-w-0 items-center justify-end gap-2" />
      </div>
    </header>
  );
}
