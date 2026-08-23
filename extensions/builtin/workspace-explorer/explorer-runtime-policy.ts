import {
  scopeMatchesContext,
  type WorkspaceContext,
  type WorkspaceSurfaceInstance,
} from "@/components/right-workspace";

export function isFileSurfaceActive(surface: WorkspaceSurfaceInstance | undefined): boolean {
  return surface?.kind === "file";
}

export function contextExplorerSurfaces(
  surfaces: readonly WorkspaceSurfaceInstance[],
  context: WorkspaceContext,
): readonly WorkspaceSurfaceInstance[] {
  return surfaces.filter(
    (surface) => surface.kind === "explorer" && scopeMatchesContext(surface.scope, context),
  );
}
