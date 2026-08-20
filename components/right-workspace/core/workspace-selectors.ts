import type {
  RightWorkspaceState,
  WorkspaceContext,
  WorkspaceScope,
  WorkspaceScopeType,
  WorkspaceSurfaceInstance,
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

export function selectActiveSurface(
  state: RightWorkspaceState,
  context: WorkspaceContext,
): WorkspaceSurfaceInstance | undefined {
  const active = state.activeSurfaceId ? state.surfaces[state.activeSurfaceId] : undefined;
  if (active && scopeMatchesContext(active.scope, context)) return active;
  return selectContextSurfaces(state, context).at(-1);
}
