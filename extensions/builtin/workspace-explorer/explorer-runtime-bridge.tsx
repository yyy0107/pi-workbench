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

import {
  contextExplorerSurfaces,
  contextSkillExplorerSurfaces,
  isFileSurfaceActive,
  skillExplorerMatchesFile,
  skillFileExplorerIdentity,
} from "./explorer-runtime-policy";

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
  const skillFileIdentity = useMemo(
    () => skillFileExplorerIdentity(activeSurface),
    [activeSurface],
  );
  const contextExplorers = useMemo(
    () => contextExplorerSurfaces(explorerSurfaces, context),
    [context, explorerSurfaces],
  );
  const skillExplorers = useMemo(
    () => contextSkillExplorerSurfaces(explorerSurfaces, context),
    [context, explorerSurfaces],
  );
  const currentExplorer = contextExplorers.find((surface) => surface.params.rootPath === rootPath);
  const currentSkillExplorer = skillFileIdentity
    ? skillExplorers.find((surface) => skillExplorerMatchesFile(surface, skillFileIdentity))
    : undefined;

  useEffect(() => {
    if (!hydrated) return;

    const shouldShow = Boolean(fileSurfaceActive && rootPath && (worktreeId ?? projectId));
    for (const surface of contextExplorers) {
      if (!shouldShow || surface.id !== currentExplorer?.id) controller.close(surface.id);
    }
    for (const surface of skillExplorers) {
      if (!skillFileIdentity || surface.id !== currentSkillExplorer?.id) {
        controller.close(surface.id);
      }
    }
    if (shouldShow && !currentExplorer && rootPath) {
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
    }
    if (!skillFileIdentity || currentSkillExplorer) return;
    controller.reveal({
      kind: "explorer",
      title: skillFileIdentity.skillName,
      params: {
        source: "skill",
        rootPath: skillFileIdentity.rootPath,
        sessionId: skillFileIdentity.sessionId,
        skillName: skillFileIdentity.skillName,
      },
      context: {
        applicationId,
        ...(threadId ? { threadId } : {}),
        ...(worktreeId ? { worktreeId } : {}),
        ...(projectId ? { projectId } : {}),
        ...(rootPath ? { rootPath } : {}),
      },
      placement: "auxiliary",
      status: "ready",
      policy: "force-focus",
    });
  }, [
    applicationId,
    contextExplorers,
    controller,
    currentExplorer,
    currentSkillExplorer,
    fileSurfaceActive,
    hydrated,
    projectId,
    rootPath,
    skillExplorers,
    skillFileIdentity,
    threadId,
    title,
    worktreeId,
  ]);

  return null;
}
