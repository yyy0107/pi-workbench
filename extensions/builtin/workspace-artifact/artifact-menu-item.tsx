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
      className="h-9 w-full justify-start gap-3 rounded-xl px-2.5 font-normal"
      onClick={() => {
        const artifactId = `scratch-${Date.now()}`;
        artifactPreviewService.upsertArtifact({
          id: artifactId,
          ...(context.threadId ? { threadId: context.threadId } : {}),
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
