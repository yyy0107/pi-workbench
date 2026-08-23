"use client";

import { ThreadListPrimitive } from "@assistant-ui/react";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import {
  useWorkspaceCapabilities,
  useWorkspaceSelection,
} from "@/services/workspace-selection-service";
import { preferredNewThreadWorkspaceId } from "@/workbench/workspaces/new-thread-policy";

export function NewThreadNavigationItem() {
  const { t } = useI18n();
  const { activeWorkspaceId, workspaces } = useWorkspaceSelection();
  const targetWorkspaceId = preferredNewThreadWorkspaceId(
    activeWorkspaceId,
    workspaces.map((workspace) => workspace.id),
  );
  const { beginNewThread, destroyNewThread } = useWorkspaceCapabilities();

  return (
    <ThreadListPrimitive.New
      asChild
      onClick={() => {
        if (targetWorkspaceId) beginNewThread(targetWorkspaceId);
        else destroyNewThread();
      }}
    >
      <Button
        type="button"
        variant="ghost"
        className="hover:bg-sidebar-accent data-active:bg-sidebar-accent h-9 w-full justify-start gap-2 rounded-lg px-3 text-base font-medium"
      >
        <PlusIcon className="size-4" />
        {t("extensions.workspaceDirectory.newThread")}
      </Button>
    </ThreadListPrimitive.New>
  );
}
