"use client";

import { FileDiffIcon } from "lucide-react";

import { useRightWorkspace, useWorkspaceContext } from "@/components/right-workspace";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { WorkspaceSurfaceMenuItemProps } from "@/platform/extensions";

export function ReviewMenuItem({ closeMenu }: WorkspaceSurfaceMenuItemProps) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const repositoryId = context.worktreeId ?? context.projectId;

  return (
    <Button
      type="button"
      variant="ghost"
      disabled={!repositoryId}
      className="w-full justify-start font-normal"
      onClick={() => {
        if (!repositoryId) return;
        controller.reveal({
          kind: "review",
          title: t("extensions.workspaceReview.title"),
          params: { repositoryId, reviewScope: "unstaged" },
          context,
          status: "idle",
        });
        closeMenu();
      }}
    >
      <FileDiffIcon className="text-muted-foreground size-4" />
      {t("extensions.workspaceReview.title")}
    </Button>
  );
}
