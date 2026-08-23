import {
  WORKSPACE_SCOPE_TYPES,
  WORKSPACE_SURFACE_PLACEMENTS,
  type OpenSurfaceRequest,
  type PersistedRightWorkspaceState,
  type RightWorkspaceState,
  type WorkspaceContext,
  type WorkspaceScope,
  type WorkspaceSurfaceInstance,
  type WorkspaceSurfacePlacement,
  type WorkspaceSurfaceRegistry,
} from "./surface-types";
import { scopeMatchesContext } from "./workspace-selectors";
import {
  DEFAULT_AUXILIARY_SURFACE_WIDTH,
  DEFAULT_RIGHT_WORKSPACE_WIDTH,
  MIN_AUXILIARY_SURFACE_WIDTH,
  MIN_RIGHT_WORKSPACE_WIDTH,
  type RightWorkspaceStoreApi,
} from "./workspace-store";

export const RIGHT_WORKSPACE_STORAGE_KEY = "pi-workbench:right-workspace:v1";

export interface WorkspaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RightWorkspaceController {
  open<P extends Record<string, unknown>>(request: OpenSurfaceRequest<P>): string;
  reveal<P extends Record<string, unknown>>(request: OpenSurfaceRequest<P>): string;
  focus(surfaceId: string): void;
  reorder(surfaceId: string, targetSurfaceId: string, position: "before" | "after"): void;
  close(surfaceId: string): void;
  closeToRight(surfaceId: string, context: WorkspaceContext): void;
  closeOthers(surfaceId: string, context?: WorkspaceContext): void;
  closeAll(): void;
  update(surfaceId: string, patch: Partial<WorkspaceSurfaceInstance>): void;
  setWorkspaceOpen(open: boolean): void;
  setWidth(width: number): void;
  setAuxiliaryOpen(open: boolean): void;
  setAuxiliaryWidth(width: number): void;
  setMaximized(maximized: boolean): void;
  restore(scope: WorkspaceScope): void;
  restoreContext(context: WorkspaceContext): void;
  hydrate(storage: WorkspaceStorage): void;
}

function createSurfaceId(kind: string): string {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${kind}:${suffix}`;
}

function defaultScopeFor(context: WorkspaceContext): WorkspaceScope {
  return { type: "application", key: context.applicationId };
}

function pushHistory(history: readonly string[], surfaceId: string): readonly string[] {
  const withoutDuplicate = history.filter((candidate) => candidate !== surfaceId);
  return [...withoutDuplicate, surfaceId].slice(-100);
}

function sameScope(left: WorkspaceScope, right: WorkspaceScope): boolean {
  return left.type === right.type && left.key === right.key;
}

function activeSurfaceIdForPlacement(
  state: RightWorkspaceState,
  placement: WorkspaceSurfacePlacement,
): string | null {
  return placement === "primary" ? state.activeSurfaceId : state.activeAuxiliarySurfaceId;
}

function activeSurfacePatch(
  placement: WorkspaceSurfacePlacement,
  surfaceId: string | null,
):
  | Pick<RightWorkspaceState, "activeSurfaceId">
  | Pick<RightWorkspaceState, "activeAuxiliarySurfaceId"> {
  return placement === "primary"
    ? { activeSurfaceId: surfaceId }
    : { activeAuxiliarySurfaceId: surfaceId };
}

function resolvePlacement(
  request: OpenSurfaceRequest,
  defaultPlacement?: WorkspaceSurfacePlacement,
): WorkspaceSurfacePlacement {
  const placement = request.placement ?? defaultPlacement ?? "primary";
  if (!WORKSPACE_SURFACE_PLACEMENTS.includes(placement)) {
    throw new Error(`Workspace surface placement "${placement}" is invalid`);
  }
  return placement;
}

function persistedState(state: RightWorkspaceState): PersistedRightWorkspaceState {
  return {
    open: state.open,
    width: state.width,
    activeSurfaceId: state.activeSurfaceId,
    activeAuxiliarySurfaceId: state.activeAuxiliarySurfaceId,
    auxiliaryOpen: state.auxiliaryOpen,
    auxiliaryWidth: state.auxiliaryWidth,
    surfaceOrder: [...state.surfaceOrder],
    surfaces: state.surfaceOrder.flatMap((id) => (state.surfaces[id] ? [state.surfaces[id]] : [])),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

type LegacyWorkspaceSurfaceInstance = Omit<WorkspaceSurfaceInstance, "placement"> & {
  placement?: unknown;
};

function isSurface(value: unknown): value is LegacyWorkspaceSurfaceInstance {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    typeof value.kind !== "string" ||
    value.kind.trim().length === 0 ||
    typeof value.title !== "string" ||
    typeof value.resourceKey !== "string" ||
    !isRecord(value.scope) ||
    typeof value.scope.type !== "string" ||
    !WORKSPACE_SCOPE_TYPES.includes(value.scope.type as WorkspaceScope["type"]) ||
    typeof value.scope.key !== "string" ||
    !isRecord(value.params) ||
    typeof value.createdAt !== "number" ||
    typeof value.lastActiveAt !== "number"
  ) {
    return false;
  }
  return true;
}

function isPlacement(value: unknown): value is WorkspaceSurfacePlacement {
  return (
    typeof value === "string" &&
    WORKSPACE_SURFACE_PLACEMENTS.includes(value as WorkspaceSurfacePlacement)
  );
}

function parsePersistedState(
  serialized: string | null,
  registry: WorkspaceSurfaceRegistry,
): Partial<RightWorkspaceState> | undefined {
  if (!serialized) return undefined;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value) || !Array.isArray(value.surfaces)) return undefined;
    const surfaces = value.surfaces
      .filter((surface) => isSurface(surface))
      .map((surface) => ({
        ...surface,
        placement: isPlacement(surface.placement)
          ? surface.placement
          : (registry.get(surface.kind)?.defaultPlacement ?? "primary"),
      }));
    const byId = Object.fromEntries(surfaces.map((surface) => [surface.id, surface]));
    const requestedOrder = Array.isArray(value.surfaceOrder)
      ? value.surfaceOrder.filter((id): id is string => typeof id === "string" && id in byId)
      : [];
    const surfaceOrder = [
      ...requestedOrder,
      ...surfaces.map((surface) => surface.id).filter((id) => !requestedOrder.includes(id)),
    ];
    const legacyActiveSurface =
      typeof value.activeSurfaceId === "string" ? byId[value.activeSurfaceId] : undefined;
    const requestedPrimary =
      legacyActiveSurface?.placement === "primary" ? legacyActiveSurface : undefined;
    const requestedAuxiliary =
      typeof value.activeAuxiliarySurfaceId === "string"
        ? byId[value.activeAuxiliarySurfaceId]
        : legacyActiveSurface?.placement === "auxiliary"
          ? legacyActiveSurface
          : undefined;
    const activeSurfaceId =
      requestedPrimary?.id ??
      surfaceOrder.findLast((surfaceId) => byId[surfaceId]?.placement === "primary") ??
      null;
    const activeAuxiliarySurfaceId =
      requestedAuxiliary?.placement === "auxiliary"
        ? requestedAuxiliary.id
        : (surfaceOrder.findLast((surfaceId) => byId[surfaceId]?.placement === "auxiliary") ??
          null);
    return {
      open: value.open === true,
      width:
        typeof value.width === "number" && Number.isFinite(value.width)
          ? Math.max(MIN_RIGHT_WORKSPACE_WIDTH, value.width)
          : DEFAULT_RIGHT_WORKSPACE_WIDTH,
      activeSurfaceId,
      activeAuxiliarySurfaceId,
      auxiliaryOpen: typeof value.auxiliaryOpen === "boolean" ? value.auxiliaryOpen : true,
      auxiliaryWidth:
        typeof value.auxiliaryWidth === "number" && Number.isFinite(value.auxiliaryWidth)
          ? Math.max(MIN_AUXILIARY_SURFACE_WIDTH, value.auxiliaryWidth)
          : DEFAULT_AUXILIARY_SURFACE_WIDTH,
      surfaceOrder,
      surfaces: byId,
      navigationHistory: [activeSurfaceId, activeAuxiliarySurfaceId].filter(
        (surfaceId): surfaceId is string => Boolean(surfaceId),
      ),
    };
  } catch {
    return undefined;
  }
}

export class DefaultRightWorkspaceController implements RightWorkspaceController {
  readonly #store: RightWorkspaceStoreApi;
  readonly #registry: WorkspaceSurfaceRegistry;
  #storage?: WorkspaceStorage;

  constructor(store: RightWorkspaceStoreApi, registry: WorkspaceSurfaceRegistry) {
    this.#store = store;
    this.#registry = registry;
  }

  open = <P extends Record<string, unknown>>(request: OpenSurfaceRequest<P>): string => {
    const definition = this.#registry.get(request.kind);
    if (!definition) throw new Error(`Workspace surface "${request.kind}" is not registered`);
    const placement = resolvePlacement(request, definition.defaultPlacement);
    const resourceKey = definition.getResourceKey(request.params, request.context);
    if (!definition.allowDuplicateResources) {
      const existing = Object.values(this.#store.getState().surfaces).find(
        (surface) => surface.kind === request.kind && surface.resourceKey === resourceKey,
      );
      if (existing) {
        this.reconcilePlacement(existing.id, placement);
        this.applyOpenPolicy(existing.id, request.policy ?? "force-focus");
        return existing.id;
      }
    }

    const id = createSurfaceId(request.kind);
    const now = Date.now();
    const surface: WorkspaceSurfaceInstance = {
      id,
      kind: request.kind,
      placement,
      title: request.title,
      resourceKey,
      scope:
        request.scope ??
        definition.getDefaultScope?.(request.params, request.context) ??
        defaultScopeFor(request.context),
      params: { ...request.params },
      status: request.status ?? "idle",
      ...(request.statusMessage ? { statusMessage: request.statusMessage } : {}),
      ...(request.dirty === undefined ? {} : { dirty: request.dirty }),
      ...(request.pinned === undefined ? {} : { pinned: request.pinned }),
      createdAt: now,
      lastActiveAt: now,
    };
    const policy = request.policy ?? "force-focus";
    this.setState((state) => {
      const activeId = activeSurfaceIdForPlacement(state, placement);
      const active = activeId ? state.surfaces[activeId] : undefined;
      const hasActiveInScope =
        active?.placement === placement && sameScope(active.scope, surface.scope);
      const activate = policy !== "background" || !hasActiveInScope;
      return {
        surfaces: { ...state.surfaces, [id]: surface },
        surfaceOrder: [...state.surfaceOrder, id],
        ...(activate ? activeSurfacePatch(placement, id) : {}),
        navigationHistory: activate
          ? pushHistory(state.navigationHistory, id)
          : state.navigationHistory,
        open: policy === "background" ? state.open : true,
        ...(placement === "auxiliary" && policy !== "background" ? { auxiliaryOpen: true } : {}),
      };
    });
    return id;
  };

  reveal = <P extends Record<string, unknown>>(request: OpenSurfaceRequest<P>): string => {
    const definition = this.#registry.get(request.kind);
    if (!definition) throw new Error(`Workspace surface "${request.kind}" is not registered`);
    const placement = resolvePlacement(request, definition.defaultPlacement);
    const resourceKey = definition.getResourceKey(request.params, request.context);
    const existing = Object.values(this.#store.getState().surfaces).find(
      (surface) => surface.kind === request.kind && surface.resourceKey === resourceKey,
    );
    if (!existing) return this.open({ ...request, policy: request.policy ?? "reveal" });

    this.reconcilePlacement(existing.id, placement);
    this.update(existing.id, {
      title: request.title,
      params: { ...existing.params, ...request.params },
      ...(request.status ? { status: request.status } : {}),
      ...(request.statusMessage ? { statusMessage: request.statusMessage } : {}),
    });
    this.applyOpenPolicy(existing.id, request.policy ?? "reveal");
    return existing.id;
  };

  focus = (surfaceId: string): void => {
    const surface = this.#store.getState().surfaces[surfaceId];
    if (!surface) return;
    const now = Date.now();
    this.setState((state) => ({
      ...activeSurfacePatch(surface.placement, surfaceId),
      open: true,
      ...(surface.placement === "auxiliary" ? { auxiliaryOpen: true } : {}),
      navigationHistory: pushHistory(state.navigationHistory, surfaceId),
      surfaces: {
        ...state.surfaces,
        [surfaceId]: { ...state.surfaces[surfaceId], lastActiveAt: now },
      },
    }));
  };

  reorder = (surfaceId: string, targetSurfaceId: string, position: "before" | "after"): void => {
    if (surfaceId === targetSurfaceId) return;
    const current = this.#store.getState();
    const surface = current.surfaces[surfaceId];
    const targetSurface = current.surfaces[targetSurfaceId];
    if (!surface || !targetSurface || surface.placement !== targetSurface.placement) return;

    const surfaceOrder = current.surfaceOrder.filter((candidate) => candidate !== surfaceId);
    const targetIndex = surfaceOrder.indexOf(targetSurfaceId);
    if (targetIndex < 0) return;
    surfaceOrder.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, surfaceId);
    if (surfaceOrder.every((candidate, index) => current.surfaceOrder[index] === candidate)) return;
    this.setState(() => ({ surfaceOrder }));
  };

  close = (surfaceId: string): void => {
    const current = this.#store.getState();
    if (!current.surfaces[surfaceId]) return;
    const surfaces = { ...current.surfaces };
    delete surfaces[surfaceId];
    const surfaceOrder = current.surfaceOrder.filter((candidate) => candidate !== surfaceId);
    const navigationHistory = current.navigationHistory.filter(
      (candidate) => candidate !== surfaceId,
    );
    const closed = current.surfaces[surfaceId];
    const matchesClosedPane = (candidate: string) => {
      const candidateSurface = surfaces[candidate];
      return (
        candidateSurface?.placement === closed.placement &&
        sameScope(candidateSurface.scope, closed.scope)
      );
    };
    const nextActiveId =
      activeSurfaceIdForPlacement(current, closed.placement) === surfaceId
        ? (navigationHistory.findLast(matchesClosedPane) ??
          surfaceOrder.findLast(matchesClosedPane) ??
          null)
        : activeSurfaceIdForPlacement(current, closed.placement);
    const activeSurfaceId = closed.placement === "primary" ? nextActiveId : current.activeSurfaceId;
    const activeAuxiliarySurfaceId =
      closed.placement === "auxiliary" ? nextActiveId : current.activeAuxiliarySurfaceId;
    this.setState(() => ({
      surfaces,
      surfaceOrder,
      navigationHistory,
      activeSurfaceId,
      activeAuxiliarySurfaceId,
      open: activeSurfaceId || activeAuxiliarySurfaceId ? current.open : false,
    }));
  };

  closeToRight = (surfaceId: string, context: WorkspaceContext): void => {
    const current = this.#store.getState();
    const surface = current.surfaces[surfaceId];
    if (!surface) return;
    const visibleIds = current.surfaceOrder.filter((candidate) => {
      const candidateSurface = current.surfaces[candidate];
      return (
        candidateSurface?.placement === surface.placement &&
        scopeMatchesContext(candidateSurface.scope, context)
      );
    });
    const surfaceIndex = visibleIds.indexOf(surfaceId);
    if (surfaceIndex < 0 || surfaceIndex === visibleIds.length - 1) return;

    const closedIds = new Set(visibleIds.slice(surfaceIndex + 1));
    const surfaces = { ...current.surfaces };
    for (const closedId of closedIds) delete surfaces[closedId];
    const activeId = activeSurfaceIdForPlacement(current, surface.placement);
    this.setState(() => ({
      surfaces,
      surfaceOrder: current.surfaceOrder.filter((candidate) => !closedIds.has(candidate)),
      navigationHistory: current.navigationHistory.filter((candidate) => !closedIds.has(candidate)),
      ...activeSurfacePatch(
        surface.placement,
        activeId && closedIds.has(activeId) ? surfaceId : activeId,
      ),
    }));
  };

  closeOthers = (surfaceId: string, context?: WorkspaceContext): void => {
    const current = this.#store.getState();
    const surface = current.surfaces[surfaceId];
    if (!surface) return;
    const retainedIds = current.surfaceOrder.filter((candidate) => {
      const candidateSurface = current.surfaces[candidate];
      return (
        candidate === surfaceId ||
        candidateSurface?.placement !== surface.placement ||
        (context ? !scopeMatchesContext(candidateSurface.scope, context) : false)
      );
    });
    const retainedSurfaces = Object.fromEntries(
      retainedIds.flatMap((candidate) =>
        current.surfaces[candidate] ? [[candidate, current.surfaces[candidate]]] : [],
      ),
    );
    this.setState(() => ({
      surfaces: retainedSurfaces,
      surfaceOrder: retainedIds,
      navigationHistory: current.navigationHistory.filter(
        (candidate) => candidate in retainedSurfaces,
      ),
      ...activeSurfacePatch(surface.placement, surfaceId),
      open: true,
      ...(surface.placement === "auxiliary" ? { auxiliaryOpen: true } : {}),
    }));
  };

  closeAll = (): void => {
    this.setState(() => ({
      surfaces: {},
      surfaceOrder: [],
      navigationHistory: [],
      activeSurfaceId: null,
      activeAuxiliarySurfaceId: null,
      open: false,
    }));
  };

  update = (surfaceId: string, patch: Partial<WorkspaceSurfaceInstance>): void => {
    if (!this.#store.getState().surfaces[surfaceId]) return;
    this.setState((state) => ({
      surfaces: {
        ...state.surfaces,
        [surfaceId]: {
          ...state.surfaces[surfaceId],
          ...patch,
          id: surfaceId,
          kind: state.surfaces[surfaceId].kind,
          placement: state.surfaces[surfaceId].placement,
          resourceKey: state.surfaces[surfaceId].resourceKey,
        },
      },
    }));
  };

  setWorkspaceOpen = (open: boolean): void => {
    this.setState(() => ({ open }));
  };

  setWidth = (width: number): void => {
    if (!Number.isFinite(width)) return;
    this.setState(() => ({ width: Math.max(MIN_RIGHT_WORKSPACE_WIDTH, width) }));
  };

  setAuxiliaryOpen = (open: boolean): void => {
    this.setState(() => ({ auxiliaryOpen: open }));
  };

  setAuxiliaryWidth = (width: number): void => {
    if (!Number.isFinite(width)) return;
    this.setState(() => ({
      auxiliaryWidth: Math.max(MIN_AUXILIARY_SURFACE_WIDTH, width),
    }));
  };

  setMaximized = (maximized: boolean): void => {
    this.setState(() => ({ maximized }));
  };

  restore = (scope: WorkspaceScope): void => {
    const state = this.#store.getState();
    const candidates = state.surfaceOrder
      .map((id) => state.surfaces[id])
      .filter((surface): surface is WorkspaceSurfaceInstance => Boolean(surface))
      .filter((surface) => sameScope(surface.scope, scope))
      .sort((left, right) => left.lastActiveAt - right.lastActiveAt);
    const primary = candidates.findLast((surface) => surface.placement === "primary");
    const auxiliary = candidates.findLast((surface) => surface.placement === "auxiliary");
    if (
      (!primary || state.activeSurfaceId === primary.id) &&
      (!auxiliary || state.activeAuxiliarySurfaceId === auxiliary.id)
    ) {
      return;
    }
    this.setState((current) => {
      let navigationHistory = current.navigationHistory;
      if (primary) navigationHistory = pushHistory(navigationHistory, primary.id);
      if (auxiliary) navigationHistory = pushHistory(navigationHistory, auxiliary.id);
      return {
        ...(primary ? { activeSurfaceId: primary.id } : {}),
        ...(auxiliary ? { activeAuxiliarySurfaceId: auxiliary.id } : {}),
        navigationHistory,
      };
    });
  };

  restoreContext = (context: WorkspaceContext): void => {
    const state = this.#store.getState();
    const candidates = state.surfaceOrder
      .map((id) => state.surfaces[id])
      .filter((surface): surface is WorkspaceSurfaceInstance => Boolean(surface))
      .filter((surface) => scopeMatchesContext(surface.scope, context))
      .sort((left, right) => left.lastActiveAt - right.lastActiveAt);
    const activeSurfaceId =
      candidates.findLast((surface) => surface.placement === "primary")?.id ?? null;
    const activeAuxiliarySurfaceId =
      candidates.findLast((surface) => surface.placement === "auxiliary")?.id ?? null;
    if (
      state.activeSurfaceId === activeSurfaceId &&
      state.activeAuxiliarySurfaceId === activeAuxiliarySurfaceId
    ) {
      return;
    }
    this.setState(() => ({ activeSurfaceId, activeAuxiliarySurfaceId }));
  };

  hydrate = (storage: WorkspaceStorage): void => {
    this.#storage = storage;
    const restored = parsePersistedState(
      storage.getItem(RIGHT_WORKSPACE_STORAGE_KEY),
      this.#registry,
    );
    this.#store.setState((state) => ({ ...state, ...restored, hydrated: true }), true);
    this.persist();
  };

  private applyOpenPolicy(surfaceId: string, policy: NonNullable<OpenSurfaceRequest["policy"]>) {
    if (policy === "background") {
      const surface = this.#store.getState().surfaces[surfaceId];
      if (!surface) return;
      this.setState((state) => {
        const activeId = activeSurfaceIdForPlacement(state, surface.placement);
        const active = activeId ? state.surfaces[activeId] : undefined;
        if (active?.placement === surface.placement && sameScope(active.scope, surface.scope)) {
          return {};
        }
        return {
          ...activeSurfacePatch(surface.placement, surfaceId),
          navigationHistory: pushHistory(state.navigationHistory, surfaceId),
        };
      });
      return;
    }
    this.focus(surfaceId);
  }

  private reconcilePlacement(surfaceId: string, placement: WorkspaceSurfacePlacement): void {
    const current = this.#store.getState();
    const surface = current.surfaces[surfaceId];
    if (!surface || surface.placement === placement) return;
    const wasActive = activeSurfaceIdForPlacement(current, surface.placement) === surfaceId;
    this.setState((state) => {
      const surfaces = {
        ...state.surfaces,
        [surfaceId]: { ...state.surfaces[surfaceId], placement },
      };
      if (!wasActive) return { surfaces };
      const matchesPreviousPane = (candidate: string) => {
        const candidateSurface = surfaces[candidate];
        return (
          candidateSurface?.placement === surface.placement &&
          sameScope(candidateSurface.scope, surface.scope)
        );
      };
      const fallback =
        state.navigationHistory.findLast(matchesPreviousPane) ??
        state.surfaceOrder.findLast(matchesPreviousPane) ??
        null;
      return {
        surfaces,
        ...activeSurfacePatch(surface.placement, fallback),
        ...activeSurfacePatch(placement, surfaceId),
      };
    });
  }

  private setState(recipe: (state: RightWorkspaceState) => Partial<RightWorkspaceState>): void {
    this.#store.setState((state) => ({ ...state, ...recipe(state) }), true);
    this.persist();
  }

  private persist(): void {
    if (!this.#storage) return;
    try {
      this.#storage.setItem(
        RIGHT_WORKSPACE_STORAGE_KEY,
        JSON.stringify(persistedState(this.#store.getState())),
      );
    } catch {
      // Layout restoration is best effort when browser storage is unavailable.
    }
  }
}
