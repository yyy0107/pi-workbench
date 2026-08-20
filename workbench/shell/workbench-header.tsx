"use client";

import { useAuiState } from "@assistant-ui/react";
import { PanelLeftOpenIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RightWorkspaceToggleButton } from "@/components/right-workspace";
import { useSidebar } from "@/components/ui/sidebar";
import { useI18n } from "@/i18n";
import { SlotHost } from "@/platform/extensions";

function SidebarOpenButton() {
  const { t } = useI18n();
  const { isMobile, state, toggleSidebar } = useSidebar();

  if (!isMobile && state === "expanded") return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={isMobile ? t("workbench.sidebar.openMobile") : t("workbench.sidebar.expand")}
      title={isMobile ? t("workbench.sidebar.openMobile") : t("workbench.sidebar.expand")}
      onClick={toggleSidebar}
    >
      <PanelLeftOpenIcon className="size-[18px]" />
    </Button>
  );
}

export function WorkbenchHeader() {
  const { t } = useI18n();
  const currentThreadTitle = useAuiState(
    (state) =>
      state.threads.threadItems.find((thread) => thread.id === state.threads.mainThreadId)?.title,
  );

  return (
    <header
      data-workbench-surface="header"
      className="bg-background grid h-10 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b px-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <SidebarOpenButton />
        <span className="truncate text-sm font-semibold">
          {currentThreadTitle || t("workbench.sidebar.newThread")}
        </span>
        <SlotHost name="header.left" className="flex items-center gap-2" />
      </div>

      <SlotHost name="header.center" className="flex items-center justify-center gap-2" />

      <div className="flex min-w-0 items-center justify-end gap-2">
        <SlotHost name="header.right" className="flex min-w-0 items-center justify-end gap-2" />
        <RightWorkspaceToggleButton />
      </div>
    </header>
  );
}
