"use client";

import { MessageCirclePlusIcon } from "lucide-react";

import { Button } from "@workbench/shell/ui";
import { useAgentRuntime } from "@workbench/agent-runtime-client";
import { useWorkbenchNavigation } from "@workbench/shell/navigation";
import { useI18n } from "@workbench/shell/i18n";
import {
  useWorkspaceCapabilities,
  useWorkspaceSelection,
} from "@workbench/agent-runtime-client/workspaces";
import { preferredNewThreadWorkspaceId } from "@workbench/shell/new-thread-policy";

export function NewThreadWorkspaceItem() {
  const { t } = useI18n();
  const runtime = useAgentRuntime();
  const navigation = useWorkbenchNavigation();
  const { activeWorkspaceId, workspaces } = useWorkspaceSelection();
  const targetWorkspaceId = preferredNewThreadWorkspaceId(
    activeWorkspaceId,
    workspaces.map((workspace) => workspace.id),
  );
  const { beginNewThread, destroyNewThread } = useWorkspaceCapabilities();

  return (
    <Button
      type="button"
      variant="ghost"
      className="hover:bg-sidebar-accent data-active:bg-sidebar-accent h-[var(--sidebar-row-height)] min-h-[var(--sidebar-row-height)] w-full justify-start gap-2 rounded-[var(--sidebar-row-radius)] border-0 px-[var(--sidebar-row-padding)] text-sm font-medium"
      onClick={() => {
        if (targetWorkspaceId) beginNewThread(targetWorkspaceId);
        else destroyNewThread();
        runtime.createDraft(targetWorkspaceId ? { workspaceId: targetWorkspaceId } : undefined);
        navigation.openHome();
      }}
    >
      <MessageCirclePlusIcon aria-hidden="true" className="size-4" />
      {t("extensions.workspaceDirectory.newThread")}
    </Button>
  );
}
