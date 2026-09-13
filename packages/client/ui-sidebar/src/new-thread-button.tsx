"use client";

import { PlusIcon } from "lucide-react";
import { useAgentRuntime } from "@workbench/agent-runtime-client";
import { useWorkspaceCapabilities } from "@workbench/agent-runtime-client/workspaces";
import { Button } from "@workbench/ui";
import { DropdownMenuItem } from "@workbench/ui";
import { SidebarRow } from "./sidebar-items";
import { useTranslationBundle } from "@workbench/i18n";
import { sidebarTranslationBundle } from "./i18n";
import { useWorkspaceSidebar } from "./workspace-sidebar-context";
import { useNewThreadLayout } from "@workbench/shell-context/layout";

export function NewThreadButton({
  className,
  workspaceId,
  active = false,
  variant = "row",
  onNavigate,
}: {
  className?: string;
  workspaceId: string;
  active?: boolean;
  variant?: "row" | "icon" | "menu";
  onNavigate?: () => void;
}) {
  const { t } = useTranslationBundle(sidebarTranslationBundle);
  const runtime = useAgentRuntime();
  const openHome = useWorkspaceSidebar((state) => state.navigation.openHome);
  const { beginNewThread } = useWorkspaceCapabilities();
  const { setDockComposerWhenEmpty } = useNewThreadLayout();
  const prepareNewThread = () => {
    beginNewThread(workspaceId);
    runtime.createDraft({ workspaceId });
    setDockComposerWhenEmpty(true);
    openHome();
    onNavigate?.();
  };
  if (variant === "menu")
    return (
      <DropdownMenuItem className={className} onClick={prepareNewThread}>
        <PlusIcon />
        {t("workbench.sidebar.newThread")}
      </DropdownMenuItem>
    );
  if (variant === "icon")
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        className={className}
        aria-label={t("workbench.sidebar.newThread")}
        onClick={prepareNewThread}
      >
        <PlusIcon />
      </Button>
    );
  return (
    <SidebarRow
      className={className}
      active={active}
      label={t("workbench.sidebar.newThread")}
      onActivate={prepareNewThread}
    />
  );
}
