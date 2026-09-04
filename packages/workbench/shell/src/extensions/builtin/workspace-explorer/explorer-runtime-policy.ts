import type { WorkspaceContext, WorkspaceSurfaceInstance } from "@workbench/extension-sdk";

import { scopeMatchesContext } from "../../../right-workspace";
import {
  fileWorkspaceSessionKey,
  resolveFileWorkspaceSession,
  type FileWorkspaceSession,
} from "../../../workspace-files";

export function activeFileWorkspaceSession(
  surface: WorkspaceSurfaceInstance | undefined,
): FileWorkspaceSession | undefined {
  return surface?.kind === "file" ? resolveFileWorkspaceSession(surface.params) : undefined;
}

export function contextExplorerSurfaces(
  surfaces: readonly WorkspaceSurfaceInstance[],
  context: WorkspaceContext,
): readonly WorkspaceSurfaceInstance[] {
  return surfaces.filter(
    (surface) => surface.kind === "explorer" && scopeMatchesContext(surface.scope, context),
  );
}

export function explorerMatchesFileWorkspace(
  surface: WorkspaceSurfaceInstance,
  session: FileWorkspaceSession,
): boolean {
  if (surface.kind !== "explorer") return false;
  const explorerSession = resolveFileWorkspaceSession(surface.params);
  return (
    explorerSession !== undefined &&
    fileWorkspaceSessionKey(explorerSession) === fileWorkspaceSessionKey(session)
  );
}
