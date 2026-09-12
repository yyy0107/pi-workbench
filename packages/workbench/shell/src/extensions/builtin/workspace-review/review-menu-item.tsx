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

  const revealReview = (reviewScope: "unstaged" | "last-turn") => {
    controller.reveal({
      kind: "review",
      title: defineMessage("extensions.workspaceReview.title"),
      params: { repositoryId: repositoryId!, reviewScope },
      context,
    });
  };

  return (
    <Button
      variant="ghost"
      className="w-full justify-start font-normal"
      disabled={!repositoryId}
      onClick={() => {
        if (!repositoryId) return;
        closeMenu();
        void workspace.describeGit(repositoryId).then(
          (status) => revealReview(status.repository ? "unstaged" : "last-turn"),
          () => revealReview("unstaged"),
        );
      }}
    >
      <FileDiffIcon />
      {t("extensions.workspaceReview.title")}
    </Button>
  );
}
