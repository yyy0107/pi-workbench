"use client";

import { useMemo } from "react";

import { useI18n } from "@/i18n";

import { selectActiveSurface, selectContextSurfaces } from "./core/workspace-selectors";
import { WorkspaceSurfaceBoundary } from "./surface-boundary";
import {
  useRightWorkspaceEnvironment,
  useRightWorkspaceState,
  useWorkspaceContext,
  useWorkspaceSurfaceDefinitions,
} from "./workspace-context";
import { WorkspaceEmptyState } from "./workspace-empty-state";
import { WorkspaceStatusLayer } from "./workspace-status-layer";

export function SurfaceHost() {
  const { t } = useI18n();
  const environment = useRightWorkspaceEnvironment();
  const context = useWorkspaceContext();
  const surfaceOrder = useRightWorkspaceState((state) => state.surfaceOrder);
  const surfacesById = useRightWorkspaceState((state) => state.surfaces);
  const activeSurfaceId = useRightWorkspaceState((state) => state.activeSurfaceId);
  const definitions = useWorkspaceSurfaceDefinitions();
  const definitionByKind = useMemo(
    () => new Map(definitions.map((definition) => [definition.kind, definition])),
    [definitions],
  );
  const state = useMemo(
    () => ({
      ...environment.store.getState(),
      surfaceOrder,
      surfaces: surfacesById,
      activeSurfaceId,
    }),
    [activeSurfaceId, environment.store, surfaceOrder, surfacesById],
  );
  const surfaces = useMemo(() => selectContextSurfaces(state, context), [context, state]);
  const active = useMemo(() => selectActiveSurface(state, context), [context, state]);

  if (!active) return <WorkspaceEmptyState />;

  return (
    <div className="relative size-full overflow-hidden">
      {surfaces.map((surface) => {
        const definition = definitionByKind.get(surface.kind);
        const isActive = surface.id === active.id;
        if ((!definition || definition.cachePolicy === "unmount") && !isActive) return null;
        if (!definition) {
          return (
            <div
              key={surface.id}
              data-surface-id={surface.id}
              data-surface-kind={surface.kind}
              data-state="unavailable"
              className="text-muted-foreground flex size-full items-center justify-center p-8 text-center text-sm"
            >
              <div>
                <p className="text-foreground font-medium">{surface.title}</p>
                <p className="mt-1 text-xs">{t("rightWorkspace.status.capabilityUnavailable")}</p>
              </div>
            </div>
          );
        }
        const Surface = definition.render;
        return (
          <div
            key={surface.id}
            data-surface-id={surface.id}
            data-surface-kind={surface.kind}
            data-state={isActive ? "active" : "inactive"}
            hidden={!isActive}
            inert={!isActive ? true : undefined}
            className="size-full"
          >
            <WorkspaceSurfaceBoundary surfaceId={surface.id}>
              <Surface surface={surface} context={context} />
            </WorkspaceSurfaceBoundary>
          </div>
        );
      })}
      <WorkspaceStatusLayer surface={active} />
    </div>
  );
}
