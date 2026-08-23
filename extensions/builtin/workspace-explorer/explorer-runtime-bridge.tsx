"use client";

import { useEffect, useMemo } from "react";

import {
  useActiveWorkspaceSurface,
  useRightWorkspace,
  useRightWorkspaceState,
  useWorkspaceContext,
  useWorkspaceSurfaces,
} from "@/components/right-workspace";
import { useI18n } from "@/i18n";

import { contextExplorerSurfaces, isFileSurfaceActive } from "./explorer-runtime-policy";

export function ExplorerRuntimeBridge() {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const hydrated = useRightWorkspaceState((state) => state.hydrated);
  const activeSurface = useActiveWorkspaceSurface();
  const explorerSurfaces = useWorkspaceSurfaces("explorer");
  const title = t("extensions.workspaceExplorer.title");
  const { applicationId, projectId, rootPath, threadId, worktreeId } = context;
  const fileSurfaceActive = isFileSurfaceActive(activeSurface);
  const contextExplorers = useMemo(
    () => contextExplorerSurfaces(explorerSurfaces, context),
    [context, explorerSurfaces],
  );
  const currentExplorer = contextExplorers.find((surface) => surface.params.rootPath === rootPath);

  useEffect(() => {
    if (!hydrated) return;

    const shouldShow = Boolean(fileSurfaceActive && rootPath && (worktreeId ?? projectId));
    for (const surface of contextExplorers) {
      if (!shouldShow || surface.id !== currentExplorer?.id) controller.close(surface.id);
    }
    if (!shouldShow || currentExplorer || !rootPath) {
      return;
    }
    controller.reveal({
      kind: "explorer",
      title,
      params: { rootPath },
      context: {
        applicationId,
        ...(threadId ? { threadId } : {}),
        ...(worktreeId ? { worktreeId } : {}),
        ...(projectId ? { projectId } : {}),
        rootPath,
      },
      status: "ready",
      policy: "background",
    });
  }, [
    applicationId,
    contextExplorers,
    controller,
    currentExplorer,
    fileSurfaceActive,
    hydrated,
    projectId,
    rootPath,
    threadId,
    title,
    worktreeId,
  ]);

  return null;
}
