import type {
  RightWorkspaceState,
  WorkspaceContext,
  WorkspaceScope,
  WorkspaceScopeType,
  WorkspaceSurfaceInstance,
  WorkspaceSurfacePlacement,
} from "./surface-types";

export function contextScopeKey(
  context: WorkspaceContext,
  type: WorkspaceScopeType,
): string | undefined {
  switch (type) {
    case "thread":
      return context.threadId;
    case "worktree":
      return context.worktreeId;
    case "project":
      return context.projectId;
    case "application":
      return context.applicationId;
  }
}

export function scopeMatchesContext(scope: WorkspaceScope, context: WorkspaceContext): boolean {
  return contextScopeKey(context, scope.type) === scope.key;
}

export function selectContextSurfaces(
  state: RightWorkspaceState,
  context: WorkspaceContext,
): readonly WorkspaceSurfaceInstance[] {
  return state.surfaceOrder.flatMap((surfaceId) => {
    const surface = state.surfaces[surfaceId];
    return surface && scopeMatchesContext(surface.scope, context) ? [surface] : [];
  });
}

export function selectContextSurfacesByPlacement(
  state: RightWorkspaceState,
  context: WorkspaceContext,
  placement: WorkspaceSurfacePlacement,
): readonly WorkspaceSurfaceInstance[] {
  return selectContextSurfaces(state, context).filter((surface) => surface.placement === placement);
}

function selectActiveSurfaceByPlacement(
  state: RightWorkspaceState,
  context: WorkspaceContext,
  placement: WorkspaceSurfacePlacement,
): WorkspaceSurfaceInstance | undefined {
  const matchesContextAndPlacement = (surfaceId: string) => {
    const surface = state.surfaces[surfaceId];
    return surface?.placement === placement && scopeMatchesContext(surface.scope, context);
  };
  const activeSurfaceId =
    placement === "primary" ? state.activeSurfaceId : state.activeAuxiliarySurfaceId;
  if (activeSurfaceId && matchesContextAndPlacement(activeSurfaceId)) {
    return state.surfaces[activeSurfaceId];
  }
  const historicalSurfaceId = state.navigationHistory.findLast(matchesContextAndPlacement);
  if (historicalSurfaceId) return state.surfaces[historicalSurfaceId];
  return selectContextSurfacesByPlacement(state, context, placement)
    .toSorted((left, right) => left.lastActiveAt - right.lastActiveAt)
    .at(-1);
}

export function selectActiveSurface(
  state: RightWorkspaceState,
  context: WorkspaceContext,
): WorkspaceSurfaceInstance | undefined {
  return selectActiveSurfaceByPlacement(state, context, "primary");
}

export function selectActiveAuxiliarySurface(
  state: RightWorkspaceState,
  context: WorkspaceContext,
): WorkspaceSurfaceInstance | undefined {
  return selectActiveSurfaceByPlacement(state, context, "auxiliary");
}
