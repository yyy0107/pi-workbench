import {
  scopeMatchesContext,
  type WorkspaceContext,
  type WorkspaceSurfaceInstance,
} from "@/components/right-workspace";

export function isFileSurfaceActive(surface: WorkspaceSurfaceInstance | undefined): boolean {
  return (
    surface?.kind === "file" &&
    surface.params.source !== "skill" &&
    typeof surface.params.absolutePath === "string" &&
    Boolean(surface.params.absolutePath.trim())
  );
}

export interface SkillFileExplorerIdentity {
  rootPath: string;
  sessionId: string;
  skillName: string;
}

function paramString(params: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function skillFileExplorerIdentity(
  surface: WorkspaceSurfaceInstance | undefined,
): SkillFileExplorerIdentity | undefined {
  if (surface?.kind !== "file" || surface.params.source !== "skill") return undefined;
  const rootPath = paramString(surface.params, "rootPath");
  const sessionId = paramString(surface.params, "sessionId");
  const skillName = paramString(surface.params, "skillName");
  return rootPath && sessionId && skillName ? { rootPath, sessionId, skillName } : undefined;
}

export function contextExplorerSurfaces(
  surfaces: readonly WorkspaceSurfaceInstance[],
  context: WorkspaceContext,
): readonly WorkspaceSurfaceInstance[] {
  return surfaces.filter(
    (surface) =>
      surface.kind === "explorer" &&
      surface.params.source !== "skill" &&
      scopeMatchesContext(surface.scope, context),
  );
}

export function contextSkillExplorerSurfaces(
  surfaces: readonly WorkspaceSurfaceInstance[],
  context: WorkspaceContext,
): readonly WorkspaceSurfaceInstance[] {
  return surfaces.filter(
    (surface) =>
      surface.kind === "explorer" &&
      surface.params.source === "skill" &&
      scopeMatchesContext(surface.scope, context),
  );
}

export function skillExplorerMatchesFile(
  surface: WorkspaceSurfaceInstance,
  identity: SkillFileExplorerIdentity,
): boolean {
  return (
    surface.params.source === "skill" &&
    surface.params.rootPath === identity.rootPath &&
    surface.params.sessionId === identity.sessionId &&
    surface.params.skillName === identity.skillName
  );
}
