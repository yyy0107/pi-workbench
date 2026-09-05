import type {
  AnyWorkspaceSurfaceDefinition,
  WorkspaceContext,
  WorkspaceSurfaceInstance,
} from "@workbench/extension-sdk";
import { scopeMatchesContext } from "./workspace-selectors";

/** In-memory ownership for activated keep-alive surfaces; never persisted with tab metadata. */
export function reconcileSurfaceMountContexts(
  previous: ReadonlyMap<string, WorkspaceContext>,
  surfaces: Readonly<Record<string, WorkspaceSurfaceInstance>>,
  definitions: ReadonlyMap<string, AnyWorkspaceSurfaceDefinition>,
  context: WorkspaceContext,
  visibleIds: readonly string[],
): ReadonlyMap<string, WorkspaceContext> {
  const next = new Map<string, WorkspaceContext>();
  for (const surface of Object.values(surfaces)) {
    if (definitions.get(surface.kind)?.cachePolicy !== "keep-alive") continue;
    const owner = previous.get(surface.id);
    if (!owner && !visibleIds.includes(surface.id)) continue;
    if (scopeMatchesContext(surface.scope, context)) next.set(surface.id, context);
    else if (owner && scopeMatchesContext(surface.scope, owner)) next.set(surface.id, owner);
  }
  return next.size === previous.size && [...next].every(([id, owner]) => previous.get(id) === owner)
    ? previous
    : next;
}
