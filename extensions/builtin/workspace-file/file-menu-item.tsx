"use client";

import { FileCode2Icon } from "lucide-react";

import { useRightWorkspace, useWorkspaceContext } from "@/components/right-workspace";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { WorkspaceSurfaceMenuItemProps } from "@/platform/extensions";

export function FileMenuItem({ closeMenu }: WorkspaceSurfaceMenuItemProps) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const hasWorkspace = Boolean(context.rootPath && (context.worktreeId ?? context.projectId));

  return (
    <Button
      type="button"
      variant="ghost"
      disabled={!hasWorkspace}
      className="w-full justify-start font-normal"
      onClick={() => {
        if (!hasWorkspace) return;
        controller.reveal({
          kind: "file",
          title: t("extensions.workspaceFile.openFileTitle"),
          params: { launcher: true },
          context,
          status: "ready",
        });
        controller.setAuxiliaryOpen(true);
        closeMenu();
      }}
    >
      <FileCode2Icon className="text-muted-foreground size-4" />
      {t("extensions.workspaceFile.title")}
    </Button>
  );
}
