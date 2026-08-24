"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

import {
  selectActiveAuxiliarySurface,
  selectActiveSurface,
  selectContextSurfacesByPlacement,
} from "./core/workspace-selectors";
import { shouldMountWorkspaceSurface } from "./core/surface-mount-policy";
import type {
  AnyWorkspaceSurfaceDefinition,
  WorkspaceContext,
  WorkspaceSurfaceInstance,
} from "./core/surface-types";
import {
  MIN_PRIMARY_SURFACE_WIDTH,
  resolveWorkspaceSplitLayout,
} from "./core/workspace-split-layout";
import { WorkspaceSurfaceBoundary } from "./surface-boundary";
import {
  useRightWorkspaceEnvironment,
  useRightWorkspaceState,
  useWorkspaceContext,
  useWorkspaceSurfaceDefinitions,
} from "./workspace-context";
import { WorkspaceEmptyState } from "./workspace-empty-state";
import { SurfaceHeaderHost } from "./surface-header-host";
import { WorkspaceSplitResizeHandle } from "./workspace-split-resize-handle";
import { WorkspaceStatusLayer } from "./workspace-status-layer";
import { workspaceTabId, workspaceTabPanelId } from "./workspace-tab-a11y";

interface SurfacePaneProps {
  active?: WorkspaceSurfaceInstance;
  activatedSurfaceIds: ReadonlySet<string>;
  context: WorkspaceContext;
  definitionByKind: ReadonlyMap<string, AnyWorkspaceSurfaceDefinition>;
  empty?: ReactNode;
  surfaces: readonly WorkspaceSurfaceInstance[];
  tabbed?: boolean;
}

function SurfacePane({
  active,
  activatedSurfaceIds,
  context,
  definitionByKind,
  empty,
  surfaces,
  tabbed = false,
}: SurfacePaneProps) {
  const { t } = useI18n();
  const controller = useRightWorkspaceEnvironment().controller;
  const [retryTokens, setRetryTokens] = useState<Readonly<Record<string, number>>>({});

  if (!active) return empty ?? null;

  return (
    <div className="relative size-full overflow-hidden">
      {surfaces.map((surface) => {
        const definition = definitionByKind.get(surface.kind);
        const isActive = surface.id === active.id;
        if (
          !shouldMountWorkspaceSurface({
            available: Boolean(definition),
            cachePolicy: definition?.cachePolicy,
            hasActivated: activatedSurfaceIds.has(surface.id),
            isActive,
          })
        ) {
          return null;
        }
        if (!definition) {
          return (
            <div
              key={surface.id}
              data-surface-id={surface.id}
              data-surface-kind={surface.kind}
              data-surface-placement={surface.placement}
              data-state="unavailable"
              role={tabbed ? "tabpanel" : undefined}
              id={tabbed ? workspaceTabPanelId(surface.id) : undefined}
              aria-labelledby={tabbed ? workspaceTabId(surface.id) : undefined}
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
            data-surface-placement={surface.placement}
            data-state={isActive ? "active" : "inactive"}
            role={tabbed ? "tabpanel" : undefined}
            id={tabbed ? workspaceTabPanelId(surface.id) : undefined}
            aria-labelledby={tabbed ? workspaceTabId(surface.id) : undefined}
            hidden={!isActive}
            inert={!isActive ? true : undefined}
            className="size-full"
          >
            <WorkspaceSurfaceBoundary surfaceId={surface.id}>
              <Suspense
                fallback={
                  <div
                    role="status"
                    className="text-muted-foreground flex size-full items-center justify-center p-8 text-center text-sm"
                  >
                    {t("rightWorkspace.status.loading")}
                  </div>
                }
              >
                <Surface
                  surface={surface}
                  context={context}
                  retryToken={retryTokens[surface.id] ?? 0}
                />
              </Suspense>
            </WorkspaceSurfaceBoundary>
          </div>
        );
      })}
      <WorkspaceStatusLayer
        surface={active}
        onRetry={() => {
          setRetryTokens((current) => ({
            ...current,
            [active.id]: (current[active.id] ?? 0) + 1,
          }));
          controller.update(active.id, { status: "ready", statusMessage: undefined });
        }}
      />
    </div>
  );
}

export function SurfaceHost() {
  const environment = useRightWorkspaceEnvironment();
  const context = useWorkspaceContext();
  const surfaceOrder = useRightWorkspaceState((state) => state.surfaceOrder);
  const surfacesById = useRightWorkspaceState((state) => state.surfaces);
  const activeSurfaceId = useRightWorkspaceState((state) => state.activeSurfaceId);
  const activeAuxiliarySurfaceId = useRightWorkspaceState(
    (state) => state.activeAuxiliarySurfaceId,
  );
  const auxiliaryOpen = useRightWorkspaceState((state) => state.auxiliaryOpen);
  const auxiliaryWidth = useRightWorkspaceState((state) => state.auxiliaryWidth);
  const [activatedSurfaceIds, setActivatedSurfaceIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const auxiliaryPaneRef = useRef<HTMLElement>(null);
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
      activeAuxiliarySurfaceId,
      auxiliaryOpen,
      auxiliaryWidth,
    }),
    [
      activeAuxiliarySurfaceId,
      activeSurfaceId,
      auxiliaryOpen,
      auxiliaryWidth,
      environment.store,
      surfaceOrder,
      surfacesById,
    ],
  );
  const primarySurfaces = useMemo(
    () => selectContextSurfacesByPlacement(state, context, "primary"),
    [context, state],
  );
  const auxiliarySurfaces = useMemo(
    () => selectContextSurfacesByPlacement(state, context, "auxiliary"),
    [context, state],
  );
  const active = useMemo(() => selectActiveSurface(state, context), [context, state]);
  const activeAuxiliary = useMemo(
    () => selectActiveAuxiliarySurface(state, context),
    [context, state],
  );
  const split = resolveWorkspaceSplitLayout(
    containerWidth,
    auxiliaryWidth,
    Boolean(activeAuxiliary),
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    let measureFrame: number | undefined;
    const measure = () => {
      measureFrame = undefined;
      const nextWidth = Math.round(element.getBoundingClientRect().width);
      setContainerWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
    };
    const scheduleMeasure = () => {
      if (measureFrame !== undefined) return;
      measureFrame = window.requestAnimationFrame(measure);
    };
    scheduleMeasure();
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (measureFrame !== undefined) window.cancelAnimationFrame(measureFrame);
    };
  }, []);

  useEffect(() => {
    const visibleIds = [active?.id, activeAuxiliary?.id].filter((id): id is string => Boolean(id));
    if (visibleIds.every((id) => activatedSurfaceIds.has(id))) return;
    setActivatedSurfaceIds((current) => {
      const next = new Set(current);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }, [active, activeAuxiliary, activatedSurfaceIds]);

  return (
    <div
      ref={containerRef}
      data-split-mode={auxiliaryOpen ? split.mode : "single"}
      className="flex size-full min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <SurfaceHeaderHost
        active={active}
        context={context}
        definition={active ? definitionByKind.get(active.kind) : undefined}
      />
      <div
        key="surface-panes"
        className={
          split.mode === "stacked"
            ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            : "flex min-h-0 min-w-0 flex-1 overflow-hidden"
        }
      >
        <div
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
          style={split.mode === "horizontal" ? { minWidth: MIN_PRIMARY_SURFACE_WIDTH } : undefined}
        >
          <SurfacePane
            active={active}
            activatedSurfaceIds={activatedSurfaceIds}
            context={context}
            definitionByKind={definitionByKind}
            empty={<WorkspaceEmptyState />}
            surfaces={primarySurfaces}
            tabbed
          />
        </div>

        {activeAuxiliary ? (
          <>
            {auxiliaryOpen ? (
              split.mode === "horizontal" ? (
                <WorkspaceSplitResizeHandle
                  key="auxiliary-resize-handle"
                  width={split.auxiliaryWidth}
                  maximum={split.maximumAuxiliaryWidth}
                  paneRef={auxiliaryPaneRef}
                />
              ) : (
                <div
                  key="auxiliary-pane-divider"
                  className="h-px shrink-0 bg-border"
                  aria-hidden="true"
                />
              )
            ) : null}
            <aside
              ref={auxiliaryPaneRef}
              key="auxiliary-pane"
              id="right-workspace-auxiliary-pane"
              aria-label={activeAuxiliary.title}
              aria-hidden={!auxiliaryOpen ? true : undefined}
              inert={!auxiliaryOpen ? true : undefined}
              data-state={auxiliaryOpen ? "open" : "closed"}
              className={cn(
                "relative min-w-0 overflow-hidden transition-[width,flex-basis,min-height,opacity,transform] duration-[240ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0",
                split.mode === "stacked"
                  ? "min-h-48 basis-[42%] data-[state=closed]:min-h-0 data-[state=closed]:basis-0 data-[state=closed]:translate-y-2"
                  : "min-h-0 shrink data-[state=closed]:shrink-0 data-[state=closed]:translate-x-2",
              )}
              style={
                split.mode === "horizontal"
                  ? { width: auxiliaryOpen ? split.auxiliaryWidth : 0 }
                  : undefined
              }
            >
              <SurfacePane
                active={activeAuxiliary}
                activatedSurfaceIds={activatedSurfaceIds}
                context={context}
                definitionByKind={definitionByKind}
                surfaces={auxiliarySurfaces}
              />
            </aside>
          </>
        ) : null}
      </div>
    </div>
  );
}
