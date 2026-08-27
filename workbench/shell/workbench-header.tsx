"use client";

import { useAuiState } from "@assistant-ui/react";
import { PanelLeftOpenIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useI18n } from "@/i18n";
import { useMainViewService } from "@/platform/extensions";
import { SlotHost } from "@/platform/extensions/hosts/slot-host";
import { useWorkbenchAgentThreadSnapshot } from "@/runtime/assistant-ui/agent-runtime-context";

const MAX_CONVERSATION_TITLE_CHARACTERS = 12;

function truncateConversationTitle(title: string): string {
  const characters = Array.from(title);
  return characters.length > MAX_CONVERSATION_TITLE_CHARACTERS
    ? `${characters.slice(0, MAX_CONVERSATION_TITLE_CHARACTERS).join("")}...`
    : title;
}

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
  const currentThread = useAuiState((state) =>
    state.threads.threadItems.find((thread) => thread.id === state.threads.mainThreadId),
  );
  const managedThread = useWorkbenchAgentThreadSnapshot(
    currentThread?.remoteId ?? currentThread?.externalId ?? currentThread?.id,
  );
  const currentThreadTitle = managedThread.title ?? currentThread?.title;
  const title = activeMainView
    ? text(activeMainView.title)
    : currentThreadTitle || t("workbench.sidebar.newThread");
  const visibleTitle = activeMainView ? title : truncateConversationTitle(title);

  return (
    <header
      data-workbench-surface="header"
      className="bg-background grid h-10 shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1 border-b ps-2 [padding-inline-end:calc(var(--right-workspace-toggle-inset-end)_+_var(--right-workspace-toggle-reserved-width))] [app-region:drag] select-none sm:grid-cols-[1fr_auto_1fr] sm:gap-0 sm:ps-3 [&_a]:[app-region:no-drag] [&_[data-slot=button]]:[app-region:no-drag]"
    >
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
        <SidebarOpenButton />
        <span
          className="min-w-0 shrink truncate text-sm font-semibold"
          aria-label={title}
          title={title}
        >
          {visibleTitle}
        </span>
        <SlotHost name="header.left" className="flex shrink-0 items-center gap-1 sm:gap-2" />
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
