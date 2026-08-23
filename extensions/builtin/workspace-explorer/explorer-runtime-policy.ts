import {
  scopeMatchesContext,
  type WorkspaceContext,
  type WorkspaceSurfaceInstance,
} from "@/components/right-workspace";

export function contextHasFileSurface(
  surfaces: readonly WorkspaceSurfaceInstance[],
  context: WorkspaceContext,
): boolean {
  return surfaces.some(
    (surface) => surface.kind === "file" && scopeMatchesContext(surface.scope, context),
  );
}

export function contextExplorerSurfaces(
  surfaces: readonly WorkspaceSurfaceInstance[],
  context: WorkspaceContext,
): readonly WorkspaceSurfaceInstance[] {
  return surfaces.filter(
    (surface) => surface.kind === "explorer" && scopeMatchesContext(surface.scope, context),
  );
}
