"use client";

import { FolderTreeIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useRightWorkspace, useWorkspaceContext } from "@/components/right-workspace";
import { useI18n } from "@/i18n";
import type { WorkspaceSurfaceMenuItemProps } from "@/platform/extensions";

export function ExplorerMenuItem({ closeMenu }: WorkspaceSurfaceMenuItemProps) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();

  return (
    <Button
      type="button"
      role="menuitem"
      variant="ghost"
      disabled={!context.rootPath || !context.worktreeId}
      className="h-9 w-full justify-start gap-3 rounded-xl px-2.5 font-normal"
      onClick={() => {
        if (!context.rootPath || !context.worktreeId) return;
        controller.reveal({
          kind: "explorer",
          title: t("extensions.workspaceExplorer.title"),
          params: { rootPath: context.rootPath },
          context,
          status: "ready",
        });
        closeMenu();
      }}
    >
      <FolderTreeIcon className="text-muted-foreground size-4" />
      {t("extensions.workspaceExplorer.title")}
    </Button>
  );
}
