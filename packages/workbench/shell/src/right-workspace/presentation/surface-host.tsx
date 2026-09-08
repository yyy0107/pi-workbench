"use client";

import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
  scopeMatchesContext,
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
import {
  RightWorkspaceReactContext,
  useRightWorkspaceEnvironment,
} from "../right-workspace-context";
import { reconcileSurfaceMountContexts } from "../surface-mount-contexts";
import { observeWorkspaceSplitResize } from "../workspace-split-resize-observer";

interface SurfacePaneProps {
  active?: WorkspaceSurfaceInstance;
  mountedContexts: ReadonlyMap<string, WorkspaceContext>;
  context: WorkspaceContext;
  definitionByKind: ReadonlyMap<string, AnyWorkspaceSurfaceDefinition>;
  empty?: ReactNode;
  paneVisible: boolean;
  surfaces: readonly WorkspaceSurfaceInstance[];
  tabbed?: boolean;
}

function SurfacePane({
  active,
  mountedContexts,
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

  return (
    <div className="relative size-full overflow-hidden">
      {!active ? empty : null}
      {surfaces.map((surface) => {
        const definition = definitionByKind.get(surface.kind);
        const isActive = surface.id === active?.id;
        const isVisible = paneVisible && isActive;
        if (
          !shouldMountWorkspaceSurface({
            available: Boolean(definition),
            cachePolicy: definition?.cachePolicy,
            dirty: surface.dirty === true,
            hasActivated: mountedContexts.has(surface.id),
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
                <SurfaceOwnerContext context={mountedContexts.get(surface.id) ?? context}>
                  <Surface
                    surface={surface}
                    context={mountedContexts.get(surface.id) ?? context}
                    isVisible={isVisible}
                    retryToken={retryTokens[surface.id] ?? 0}
                  />
                </SurfaceOwnerContext>
              </Suspense>
            </WorkspaceSurfaceBoundary>
          </div>
        );
      })}
      {active ? (
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
      ) : null}
    </div>
  );
}

function SurfaceOwnerContext({
  context,
  children,
}: {
  context: WorkspaceContext;
  children: ReactNode;
}) {
  const environment = useRightWorkspaceEnvironment();
  const value = useMemo(() => ({ ...environment, context }), [environment, context]);
  return (
    <RightWorkspaceReactContext.Provider value={value}>
      {children}
    </RightWorkspaceReactContext.Provider>
  );
}

export function SurfaceHost({ isVisible = true }: { isVisible?: boolean }) {
  const { text } = useI18n();
  const domIds = useWorkbenchDomIds();
  const context = useWorkspaceContext();
  const state = useRightWorkspaceState((current) => current);
  const { auxiliaryOpen, auxiliaryWidth } = state;
  const workspaceOpen = isVisible && state.open;
  const [previousMountedContexts, setMountedContexts] = useState<
    ReadonlyMap<string, WorkspaceContext>
  >(() => new Map());
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const auxiliaryPaneRef = useRef<HTMLElement>(null);
  const definitions = useWorkspaceSurfaceDefinitions();
  const definitionByKind = useMemo(
    () => new Map(definitions.map((definition) => [definition.kind, definition])),
    [definitions],
  );
  const active = useMemo(() => selectActiveSurface(state, context), [context, state]);
  const activeAuxiliary = useMemo(
    () => selectActiveAuxiliarySurface(state, context),
    [context, state],
  );
  const activeAuxiliaryId = activeAuxiliary?.id;
  const auxiliaryVisible = auxiliaryOpen && Boolean(activeAuxiliary);
  const mountedContexts = reconcileSurfaceMountContexts(
    previousMountedContexts,
    state.surfaces,
    definitionByKind,
    context,
    workspaceOpen
      ? [active?.id, auxiliaryVisible ? activeAuxiliaryId : undefined].filter((id): id is string =>
          Boolean(id),
        )
      : [],
  );
  useLayoutEffect(() => {
    if (mountedContexts !== previousMountedContexts) setMountedContexts(mountedContexts);
  }, [mountedContexts, previousMountedContexts]);
  const mountedSurfaces = state.surfaceOrder.flatMap((id) => {
    const surface = state.surfaces[id];
    return surface && (scopeMatchesContext(surface.scope, context) || mountedContexts.has(id))
      ? [surface]
      : [];
  });
  const primarySurfaces = mountedSurfaces.filter((surface) => surface.placement === "primary");
  const auxiliarySurfaces = mountedSurfaces.filter((surface) => surface.placement === "auxiliary");
  const split = resolveWorkspaceSplitLayout(
    containerWidth,
    auxiliaryWidth,
    Boolean(activeAuxiliary),
  );

  useEffect(() => {
    if (!workspaceOpen || !auxiliaryOpen || !activeAuxiliaryId) return;
    const element = containerRef.current;
    if (!element) return;
    return observeWorkspaceSplitResize(element, (nextWidth) => {
      setContainerWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
    });
  }, [activeAuxiliaryId, auxiliaryOpen, workspaceOpen]);

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
            mountedContexts={mountedContexts}
            context={context}
            definitionByKind={definitionByKind}
            empty={workspaceOpen ? <WorkspaceEmptyState /> : null}
            paneVisible={workspaceOpen}
            surfaces={primarySurfaces}
            tabbed
          />
        </div>

        {activeAuxiliary || auxiliarySurfaces.length > 0 ? (
          <>
            {auxiliaryVisible ? (
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
              aria-label={activeAuxiliary ? text(activeAuxiliary.title) : undefined}
              aria-hidden={!auxiliaryVisible ? true : undefined}
              inert={!auxiliaryVisible ? true : undefined}
              data-state={auxiliaryVisible ? "open" : "closed"}
              className={cn(
                "relative min-w-0 overflow-hidden transition-[width,flex-basis,min-height,opacity,transform] duration-[240ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none in-data-[resizing=true]:transition-none data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0",
                split.mode === "stacked"
                  ? "min-h-48 basis-[42%] data-[state=closed]:min-h-0 data-[state=closed]:basis-0 data-[state=closed]:translate-y-2"
                  : "min-h-0 shrink data-[state=closed]:shrink-0 data-[state=closed]:translate-x-2",
              )}
              style={
                split.mode === "horizontal"
                  ? { width: auxiliaryVisible ? split.auxiliaryWidth : 0 }
                  : undefined
              }
            >
              <SurfacePane
                active={activeAuxiliary}
                mountedContexts={mountedContexts}
                context={context}
                definitionByKind={definitionByKind}
                paneVisible={workspaceOpen && auxiliaryVisible}
                surfaces={auxiliarySurfaces}
              />
            </aside>
          </>
        ) : null}
      </div>
    </div>
  );
}
