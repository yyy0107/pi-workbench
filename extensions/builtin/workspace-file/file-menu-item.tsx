"use client";

import { FileCode2Icon } from "lucide-react";
import { useSyncExternalStore } from "react";

import {
  useOpenerService,
  useRightWorkspace,
  useWorkspaceContext,
} from "@/components/right-workspace";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { WorkspaceSurfaceMenuItemProps } from "@/platform/extensions";
import { fileWorkspaceTargetService } from "@/services/file-workspace-target-service";

export function FileMenuItem({ closeMenu }: WorkspaceSurfaceMenuItemProps) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const opener = useOpenerService();
  const context = useWorkspaceContext();
  const directoryResource = useSyncExternalStore(
    fileWorkspaceTargetService.subscribe,
    fileWorkspaceTargetService.getSnapshot,
    fileWorkspaceTargetService.getInitialSnapshot,
  );
  const workspaceId = context.worktreeId ?? context.projectId;
  const hasWorkspace = Boolean(context.rootPath && workspaceId);
  const canOpenFileWorkspace = Boolean(directoryResource || hasWorkspace);

  return (
    <Button
      type="button"
      variant="ghost"
      disabled={!canOpenFileWorkspace}
      className="w-full justify-start font-normal"
      onClick={() => {
        if (directoryResource) {
          closeMenu();
          void opener
            .open({
              resource: directoryResource,
              context,
              policy: "force-focus",
            })
            .catch((error: unknown) => {
              console.error(error);
            });
          return;
        }
        if (!hasWorkspace) return;
        controller.reveal({
          kind: "file",
          title: t("extensions.workspaceFile.openFileTitle"),
          params: {
            source: "workspace",
            rootPath: context.rootPath,
            workspaceId,
          },
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
