"use client";

import { ThreadListPrimitive } from "@assistant-ui/react";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { preferredNewThreadWorkspaceId } from "@/workbench/workspaces/new-thread-policy";
import { useWorkspaceDirectoryStore } from "@/workbench/workspaces/workspace-directory-store";

export function NewThreadNavigationItem() {
  const { t } = useI18n();
  const targetWorkspaceId = useWorkspaceDirectoryStore((state) =>
    preferredNewThreadWorkspaceId(
      state.activeDirectoryId,
      state.directories.map((directory) => directory.id),
    ),
  );
  const beginNewThread = useWorkspaceDirectoryStore((state) => state.beginNewThread);
  const destroyNewThread = useWorkspaceDirectoryStore((state) => state.destroyNewThread);

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
