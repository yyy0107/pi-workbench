"use client";

import { PlusIcon } from "lucide-react";
import { useAgentRuntime } from "@workbench/agent-runtime-client";
import { useWorkspaceCapabilities } from "@workbench/agent-runtime-client/workspaces";
import { Button } from "../ui/button";
import { DropdownMenuItem } from "../ui/dropdown-menu";
import { SidebarRow } from "../ui/sidebar-items";
import { useI18n } from "../i18n";
import { useWorkbenchNavigation } from "../navigation";

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
  const { t } = useI18n();
  const runtime = useAgentRuntime();
  const navigation = useWorkbenchNavigation();
  const { beginNewThread } = useWorkspaceCapabilities();
  const prepareNewThread = () => {
    beginNewThread(workspaceId);
    runtime.createDraft({ workspaceId });
    navigation.openHome();
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
