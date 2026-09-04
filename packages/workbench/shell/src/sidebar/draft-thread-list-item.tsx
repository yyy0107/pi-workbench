"use client";

import { useWorkspaceCapabilities } from "@workbench/agent-runtime-client/workspaces";
import { useI18n } from "../i18n";
import { useWorkbenchNavigation } from "../navigation";
import { SidebarRow } from "../ui/sidebar-items";

export function DraftThreadListItem({
  workspaceId,
  onNavigate,
}: {
  workspaceId: string;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const navigation = useWorkbenchNavigation();
  const { activateWorkspace } = useWorkspaceCapabilities();
  return (
    <SidebarRow
      active
      data-thread-status="new"
      label={t("workbench.sidebar.newThread")}
      onActivate={() => {
        activateWorkspace(workspaceId);
        navigation.openHome();
        onNavigate?.();
      }}
    />
  );
}
