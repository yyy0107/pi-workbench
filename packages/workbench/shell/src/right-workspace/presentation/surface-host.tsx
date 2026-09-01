"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useI18n } from "../../i18n";
import { cn } from "../../utils";
import type {
  AnyWorkspaceSurfaceDefinition,
  WorkspaceContext,
  WorkspaceSurfaceInstance,
} from "@workbench/extension-sdk";
import {
  selectActiveAuxiliarySurface,
  selectActiveSurface,
  selectContextSurfacesByPlacement,
  shouldMountWorkspaceSurface,
  workspaceTabId,
  workspaceTabPanelId,
  MIN_PRIMARY_SURFACE_WIDTH,
  resolveWorkspaceSplitLayout,
} from "../../right-workspace";
import { WorkspaceSurfaceBoundary } from "./surface-boundary";
import {
  useRightWorkspace,
  useRightWorkspaceState,
  useWorkspaceContext,
  useWorkspaceSurfaceDefinitions,
} from "../../right-workspace-react";
import { WorkspaceEmptyState } from "./workspace-empty-state";
import { SurfaceHeaderHost } from "./surface-header-host";
import { WorkspaceSplitResizeHandle } from "./workspace-split-resize-handle";
import { WorkspaceStatusLayer } from "./workspace-status-layer";
import { useWorkbenchDomIds } from "../../dom";

interface SurfacePaneProps {
  active?: WorkspaceSurfaceInstance;
  activatedSurfaceIds: ReadonlySet<string>;
  context: WorkspaceContext;
  definitionByKind: ReadonlyMap<string, AnyWorkspaceSurfaceDefinition>;
  empty?: ReactNode;
  paneVisible: boolean;
  surfaces: readonly WorkspaceSurfaceInstance[];
  tabbed?: boolean;
}

function SurfacePane({
  active,
  activatedSurfaceIds,
  context,
  definitionByKind,
  empty,
  paneVisible,
  surfaces,
  tabbed = false,
}: SurfacePaneProps) {
  const { t, text } = useI18n();
  const domIds = useWorkbenchDomIds();
  const controller = useRightWorkspace();
  const [retryTokens, setRetryTokens] = useState<Readonly<Record<string, number>>>({});

  if (!active) return empty ?? null;

  return (
    <div className="relative size-full overflow-hidden">
      {surfaces.map((surface) => {
        const definition = definitionByKind.get(surface.kind);
        const isActive = surface.id === active.id;
        const isVisible = paneVisible && isActive;
        if (
          !shouldMountWorkspaceSurface({
            available: Boolean(definition),
            cachePolicy: definition?.cachePolicy,
            dirty: surface.dirty === true,
            hasActivated: activatedSurfaceIds.has(surface.id),
            isVisible,
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
              id={
                tabbed
                  ? workspaceTabPanelId(domIds.rightWorkspaceTabPanelIdPrefix, surface.id)
                  : undefined
              }
              aria-labelledby={
                tabbed ? workspaceTabId(domIds.rightWorkspaceTabIdPrefix, surface.id) : undefined
              }
              className="text-muted-foreground flex size-full items-center justify-center p-8 text-center text-sm"
            >
              <div>
                <p className="text-foreground font-medium">{text(surface.title)}</p>
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
            data-state={isVisible ? "active" : "inactive"}
            role={tabbed ? "tabpanel" : undefined}
            id={
              tabbed
                ? workspaceTabPanelId(domIds.rightWorkspaceTabPanelIdPrefix, surface.id)
                : undefined
            }
            aria-labelledby={
              tabbed ? workspaceTabId(domIds.rightWorkspaceTabIdPrefix, surface.id) : undefined
            }
            hidden={!isVisible}
            inert={!isVisible ? true : undefined}
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
                  isVisible={isVisible}
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
  const { text } = useI18n();
  const domIds = useWorkbenchDomIds();
  const context = useWorkspaceContext();
  const state = useRightWorkspaceState((current) => current);
  const { auxiliaryOpen, auxiliaryWidth, open: workspaceOpen } = state;
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
  const activeAuxiliaryId = activeAuxiliary?.id;
  const split = resolveWorkspaceSplitLayout(
    containerWidth,
    auxiliaryWidth,
    Boolean(activeAuxiliary),
  );

  useEffect(() => {
    if (!workspaceOpen || !auxiliaryOpen || !activeAuxiliaryId) return;
    const element = containerRef.current;
    if (!element) return;
    const workspace = element.closest<HTMLElement>('[data-workbench-surface="right-workspace"]');
    let measureFrame: number | undefined;
    const measure = () => {
      measureFrame = undefined;
      if (workspace?.dataset.resizing === "true") return;
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
    const resizeStateObserver = workspace
      ? new MutationObserver(() => {
          if (workspace.dataset.resizing !== "true") scheduleMeasure();
        })
      : undefined;
    if (workspace) {
      resizeStateObserver?.observe(workspace, {
        attributes: true,
        attributeFilter: ["data-resizing"],
      });
    }
    return () => {
      observer.disconnect();
      resizeStateObserver?.disconnect();
      if (measureFrame !== undefined) window.cancelAnimationFrame(measureFrame);
    };
  }, [activeAuxiliaryId, auxiliaryOpen, workspaceOpen]);

  useEffect(() => {
    const visibleIds = workspaceOpen
      ? [active?.id, auxiliaryOpen ? activeAuxiliary?.id : undefined].filter((id): id is string =>
          Boolean(id),
        )
      : [];
    if (visibleIds.every((id) => activatedSurfaceIds.has(id))) return;
    setActivatedSurfaceIds((current) => {
      const next = new Set(current);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }, [active, activeAuxiliary, activatedSurfaceIds, auxiliaryOpen, workspaceOpen]);

  return (
    <div
      ref={containerRef}
      data-split-mode={auxiliaryOpen ? split.mode : "single"}
      className="flex size-full min-h-0 min-w-0 flex-col overflow-hidden"
    >
      {workspaceOpen ? (
        <SurfaceHeaderHost
          active={active}
          context={context}
          definition={active ? definitionByKind.get(active.kind) : undefined}
        />
      ) : null}
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
            empty={workspaceOpen ? <WorkspaceEmptyState /> : null}
            paneVisible={workspaceOpen}
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
              id={domIds.rightWorkspaceAuxiliaryPane}
              aria-label={text(activeAuxiliary.title)}
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
                paneVisible={workspaceOpen && auxiliaryOpen}
                surfaces={auxiliarySurfaces}
              />
            </aside>
          </>
        ) : null}
      </div>
    </div>
  );
}
