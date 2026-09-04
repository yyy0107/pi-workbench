"use client";

import { FileCode2Icon } from "lucide-react";
import { useSyncExternalStore } from "react";

import {
  useOpenerService,
  useRightWorkspace,
  useWorkspaceContext,
} from "@workbench/shell/right-workspace/react";
import { Button } from "@workbench/shell/ui";
import { defineMessage, useI18n } from "@workbench/shell/i18n";
import { useExtensionErrorReporter } from "@workbench/extension-host";
import type { WorkspaceSurfaceMenuItemProps } from "@workbench/extension-sdk";
import { useFileWorkspaceTargetService } from "@workbench/shell/workspace-files";
import { useWorkbenchWorkspaceCapability } from "@workbench/agent-runtime-client/context";

export function FileMenuItem({ closeMenu }: WorkspaceSurfaceMenuItemProps) {
  const workspace = useWorkbenchWorkspaceCapability();
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const opener = useOpenerService();
  const context = useWorkspaceContext();
  const reportError = useExtensionErrorReporter();
  const targetService = useFileWorkspaceTargetService();
  const directoryResource = useSyncExternalStore(
    targetService.subscribe,
    targetService.getSnapshot,
    targetService.getInitialSnapshot,
  );
  const workspaceId = context.worktreeId ?? context.projectId;
  const hasWorkspace = Boolean(workspace && context.rootPath && workspaceId);
  const canOpenFileWorkspace = Boolean(directoryResource || hasWorkspace);

  if (!workspace && !directoryResource) return null;

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
              reportError(error, { source: "workspace", contributionId: "file" });
            });
          return;
        }
        if (!hasWorkspace) return;
        controller.reveal({
          kind: "file",
          title: defineMessage("extensions.workspaceFile.openFileTitle"),
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
