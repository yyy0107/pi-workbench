"use client";

import { FileOutputIcon } from "lucide-react";

import { useRightWorkspace, useWorkspaceContext } from "@/components/right-workspace";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { WorkspaceSurfaceMenuItemProps } from "@/platform/extensions";

import { artifactPreviewService } from "./artifact-preview-service";

export function ArtifactMenuItem({ closeMenu }: WorkspaceSurfaceMenuItemProps) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();

  return (
    <Button
      type="button"
      variant="ghost"
      className="w-full justify-start font-normal"
      onClick={() => {
        const artifactId = `scratch-${Date.now()}`;
        const scope = context.threadId
          ? ({ type: "thread", key: context.threadId } as const)
          : ({ type: "application", key: context.applicationId } as const);
        artifactPreviewService.upsertArtifact({
          id: artifactId,
          scope,
          title: t("extensions.workspaceArtifact.title"),
          rendererKind: "markdown",
          content: "",
          updatedAt: Date.now(),
        });
        controller.reveal({
          kind: "artifact",
          title: t("extensions.workspaceArtifact.title"),
          params: { artifactId, rendererHint: "markdown" },
          context,
          scope,
          status: "ready",
        });
        closeMenu();
      }}
    >
      <FileOutputIcon className="text-muted-foreground size-4" />
      {t("extensions.workspaceArtifact.title")}
    </Button>
  );
}
