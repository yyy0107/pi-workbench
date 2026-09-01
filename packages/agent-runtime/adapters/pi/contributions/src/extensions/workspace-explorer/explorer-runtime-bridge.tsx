"use client";

import { useEffect, useMemo } from "react";

import {
  useActiveWorkspaceSurface,
  useRightWorkspace,
  useRightWorkspaceState,
  useWorkspaceContext,
  useWorkspaceSurfaces,
} from "@workbench/shell/right-workspace/react";

import { definePiMessage } from "../../i18n";

import {
  activeFileWorkspaceSession,
  contextExplorerSurfaces,
  explorerMatchesFileWorkspace,
} from "./explorer-runtime-policy";

const DEFAULT_EXPLORER_TITLE = definePiMessage("extensions.workspaceExplorer.title");

export function ExplorerRuntimeBridge() {
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const hydrated = useRightWorkspaceState((state) => state.hydrated);
  const activeSurface = useActiveWorkspaceSurface();
  const explorerSurfaces = useWorkspaceSurfaces("explorer");
  const fileSession = useMemo(() => activeFileWorkspaceSession(activeSurface), [activeSurface]);
  const contextExplorers = useMemo(
    () => contextExplorerSurfaces(explorerSurfaces, context),
    [context, explorerSurfaces],
  );
  const currentExplorer = fileSession
    ? contextExplorers.find((surface) => explorerMatchesFileWorkspace(surface, fileSession))
    : undefined;

  useEffect(() => {
    if (!hydrated) return;

    for (const surface of contextExplorers) {
      if (!fileSession || surface.id !== currentExplorer?.id) controller.close(surface.id);
    }
    if (!fileSession || currentExplorer) return;

    const title =
      fileSession.source === "skill"
        ? fileSession.skillName
        : fileSession.source === "extension"
          ? fileSession.extensionName
          : DEFAULT_EXPLORER_TITLE;
    controller.reveal({
      kind: "explorer",
      title,
      params: { ...fileSession },
      context,
      placement: "auxiliary",
      status: "ready",
      policy: fileSession.source === "workspace" ? "background" : "force-focus",
    });
  }, [context, contextExplorers, controller, currentExplorer, fileSession, hydrated]);

  return null;
}
