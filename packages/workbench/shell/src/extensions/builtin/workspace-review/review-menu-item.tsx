"use client";

import { FileDiffIcon } from "lucide-react";
import type { WorkspaceSurfaceMenuItemProps } from "@workbench/extension-sdk";
import { useWorkbenchWorkspaceCapability } from "@workbench/agent-runtime-client/context";
import { useRightWorkspace, useWorkspaceContext } from "../../../right-workspace-react";
import { Button } from "../../../ui";
import { defineMessage, useI18n } from "../../../i18n";

export function ReviewMenuItem({ closeMenu }: WorkspaceSurfaceMenuItemProps) {
  const workspace = useWorkbenchWorkspaceCapability();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const { t } = useI18n();
  const repositoryId = context.worktreeId ?? context.projectId;
  if (!workspace?.readGitDiff) return null;
  return (
    <Button
      variant="ghost"
      className="w-full justify-start font-normal"
      disabled={!repositoryId}
      onClick={() => {
        if (!repositoryId) return;
        controller.reveal({
          kind: "review",
          title: defineMessage("extensions.workspaceReview.title"),
          params: { repositoryId, reviewScope: "unstaged" },
          context,
        });
        closeMenu();
      }}
    >
      <FileDiffIcon />
      {t("extensions.workspaceReview.title")}
    </Button>
  );
}
