import {
  WORKSPACE_SCOPE_TYPES,
  WORKSPACE_SURFACE_PLACEMENTS,
  type LocalizableText,
  type OpenSurfaceRequest,
  type WorkspaceContext,
  type WorkspaceScope,
  type WorkspaceSurfaceInstance,
  type WorkspaceSurfacePlacement,
  type WorkspaceSurfaceRegistry,
  type WorkspaceSurfaceStatus,
} from "@workbench/extension-sdk";
import {
  scopeMatchesContext,
  selectActiveAuxiliarySurface,
  selectActiveSurface,
} from "./workspace-selectors";
import {
  DEFAULT_AUXILIARY_SURFACE_WIDTH,
  DEFAULT_RIGHT_WORKSPACE_WIDTH,
  MIN_AUXILIARY_SURFACE_WIDTH,
  MIN_RIGHT_WORKSPACE_WIDTH,
  type RightWorkspaceStoreApi,
} from "./workspace-store";
import type { PersistedRightWorkspaceState, RightWorkspaceState } from "./surface-types";

export type LocalizableTextValidator = (candidate: unknown) => candidate is LocalizableText;

export interface RightWorkspacePersistencePort {
  read(): Promise<string | null>;
  write(serialized: string): Promise<void>;
}

export interface RightWorkspaceControllerOptions {
  readonly validateLocalizableText: LocalizableTextValidator;
  readonly persistence?: RightWorkspacePersistencePort;
}

export class RightWorkspaceControllerDisposedError extends Error {
  constructor() {
    super("The RightWorkspace controller installation has been disposed.");
    this.name = "RightWorkspaceControllerDisposedError";
  }
}

export interface RightWorkspaceController {
  open<P extends Record<string, unknown>>(request: OpenSurfaceRequest<P>): string;
  reveal<P extends Record<string, unknown>>(request: OpenSurfaceRequest<P>): string;
  focus(surfaceId: string): void;
  reorder(surfaceId: string, targetSurfaceId: string, position: "before" | "after"): void;
  close(surfaceId: string, context?: WorkspaceContext): void;
  closeToRight(surfaceId: string, context: WorkspaceContext): void;
  closeOthers(surfaceId: string, context?: WorkspaceContext): void;
  closeAll(): void;
  update(surfaceId: string, patch: Partial<WorkspaceSurfaceInstance>): void;
  /**
   * Promotes every surface in one provisional thread scope to `nextContext.threadId`.
   * Scope, resource identity, and any resulting non-duplicate collision are committed atomically.
   */
  promoteThreadScope(fromThreadKey: string, nextContext: WorkspaceContext): void;
  resetLayout(): void;
  setWorkspaceOpen(open: boolean): void;
  setWidth(width: number): void;
  setAuxiliaryOpen(open: boolean): void;
  setAuxiliaryWidth(width: number): void;
  setMaximized(maximized: boolean): void;
  restore(scope: WorkspaceScope): void;
  restoreContext(context: WorkspaceContext): void;
  initialize(): Promise<void>;
  dispose(): void;
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

function persistedState(
  state: RightWorkspaceState,
  registry: WorkspaceSurfaceRegistry,
): PersistedRightWorkspaceState {
  const surfaceOrder = state.surfaceOrder.filter((id) => {
    const surface = state.surfaces[id];
    return surface && registry.get(surface.kind)?.persistence !== "session";
  });
  const surfaces = surfaceOrder.flatMap((id) => (state.surfaces[id] ? [state.surfaces[id]] : []));
  const activeSurfaceId = surfaceOrder.includes(state.activeSurfaceId ?? "")
    ? state.activeSurfaceId
    : (surfaceOrder.findLast((id) => state.surfaces[id]?.placement === "primary") ?? null);
  const activeAuxiliarySurfaceId = surfaceOrder.includes(state.activeAuxiliarySurfaceId ?? "")
    ? state.activeAuxiliarySurfaceId
    : (surfaceOrder.findLast((id) => state.surfaces[id]?.placement === "auxiliary") ?? null);
  return {
    open: state.open && (surfaces.length > 0 || state.surfaceOrder.length === 0),
    width: state.width,
    activeSurfaceId,
    activeAuxiliarySurfaceId,
    auxiliaryOpen: state.auxiliaryOpen,
    auxiliaryWidth: state.auxiliaryWidth,
    surfaceOrder,
    surfaces,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

type LegacyWorkspaceSurfaceInstance = Omit<WorkspaceSurfaceInstance, "placement"> & {
  placement?: unknown;
};

const WORKSPACE_SURFACE_STATUSES = [
  "idle",
  "loading",
  "ready",
  "error",
  "disconnected",
  "permission-required",
  "resource-changed",
] as const satisfies readonly WorkspaceSurfaceStatus[];

function isSurfaceStatus(value: unknown): value is WorkspaceSurfaceStatus {
  return (
    typeof value === "string" &&
    WORKSPACE_SURFACE_STATUSES.includes(value as WorkspaceSurfaceStatus)
  );
}

function isSurface(
  value: unknown,
  validateLocalizableText: LocalizableTextValidator,
): value is LegacyWorkspaceSurfaceInstance {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    typeof value.kind !== "string" ||
    value.kind.trim().length === 0 ||
    !validateLocalizableText(value.title) ||
    typeof value.resourceKey !== "string" ||
    !isRecord(value.scope) ||
    typeof value.scope.type !== "string" ||
    !WORKSPACE_SCOPE_TYPES.includes(value.scope.type as WorkspaceScope["type"]) ||
    typeof value.scope.key !== "string" ||
    !isRecord(value.params) ||
    typeof value.createdAt !== "number" ||
    !Number.isFinite(value.createdAt) ||
    typeof value.lastActiveAt !== "number" ||
    !Number.isFinite(value.lastActiveAt) ||
    !isSurfaceStatus(value.status)
  ) {
    return false;
  }
  if (value.statusMessage !== undefined && !validateLocalizableText(value.statusMessage)) {
    return false;
  }
  if (value.dirty !== undefined && typeof value.dirty !== "boolean") return false;
  if (value.pinned !== undefined && typeof value.pinned !== "boolean") return false;
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
  validateLocalizableText: LocalizableTextValidator,
): Partial<RightWorkspaceState> | undefined {
  if (!serialized) return undefined;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value) || !Array.isArray(value.surfaces)) return undefined;
    const surfaceById = new Map<string, WorkspaceSurfaceInstance>();
    for (const candidate of value.surfaces) {
      if (!isSurface(candidate, validateLocalizableText)) continue;
      if (surfaceById.has(candidate.id)) continue;
      if (registry.get(candidate.kind)?.persistence === "session") continue;
      const surface: WorkspaceSurfaceInstance = {
        ...candidate,
        placement: isPlacement(candidate.placement)
          ? candidate.placement
          : (registry.get(candidate.kind)?.defaultPlacement ?? "primary"),
      };
      surfaceById.set(surface.id, surface);
    }
    const requestedOrder: string[] = [];
    const requestedIds = new Set<string>();
    if (Array.isArray(value.surfaceOrder)) {
      for (const candidate of value.surfaceOrder) {
        if (typeof candidate !== "string") continue;
        if (!surfaceById.has(candidate) || requestedIds.has(candidate)) continue;
        requestedIds.add(candidate);
        requestedOrder.push(candidate);
      }
    }
    const surfaceOrder = [
      ...requestedOrder,
      ...Array.from(surfaceById.keys()).filter((id) => !requestedIds.has(id)),
    ];
    const legacyActiveSurface =
      typeof value.activeSurfaceId === "string"
        ? surfaceById.get(value.activeSurfaceId)
        : undefined;
    const requestedPrimary =
      legacyActiveSurface?.placement === "primary" ? legacyActiveSurface : undefined;
    const requestedAuxiliary =
      typeof value.activeAuxiliarySurfaceId === "string"
        ? surfaceById.get(value.activeAuxiliarySurfaceId)
        : legacyActiveSurface?.placement === "auxiliary"
          ? legacyActiveSurface
          : undefined;
    const activeSurfaceId =
      requestedPrimary?.id ??
      surfaceOrder.findLast((surfaceId) => surfaceById.get(surfaceId)?.placement === "primary") ??
      null;
    const activeAuxiliarySurfaceId =
      requestedAuxiliary?.placement === "auxiliary"
        ? requestedAuxiliary.id
        : (surfaceOrder.findLast(
            (surfaceId) => surfaceById.get(surfaceId)?.placement === "auxiliary",
          ) ?? null);
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
      surfaces: Object.fromEntries(surfaceById),
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
  readonly #validateLocalizableText: LocalizableTextValidator;
  #persistence?: RightWorkspacePersistencePort;
  readonly #initialMutationRevision: number;
  #mutationRevision = 0;
  #initialization?: Promise<void>;
  #writeTail: Promise<void> = Promise.resolve();
  #persistenceActive = false;
  #disposed = false;

  constructor(
    store: RightWorkspaceStoreApi,
    registry: WorkspaceSurfaceRegistry,
    options: RightWorkspaceControllerOptions,
  ) {
    this.#store = store;
    this.#registry = registry;
    this.#validateLocalizableText = options.validateLocalizableText;
    this.#persistence = options.persistence;
    this.#initialMutationRevision = this.#mutationRevision;
  }

  open = <P extends Record<string, unknown>>(request: OpenSurfaceRequest<P>): string => {
    this.assertNotDisposed();
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
    this.assertNotDisposed();
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
    this.assertNotDisposed();
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
    this.assertNotDisposed();
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

  close = (surfaceId: string, context?: WorkspaceContext): void => {
    this.assertNotDisposed();
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
        (context
          ? scopeMatchesContext(candidateSurface.scope, context)
          : sameScope(candidateSurface.scope, closed.scope))
      );
    };
    const closedIndex = current.surfaceOrder.indexOf(surfaceId);
    const adjacentSurfaceIds =
      closedIndex >= 0
        ? [
            ...current.surfaceOrder.slice(closedIndex + 1),
            ...current.surfaceOrder.slice(0, closedIndex).reverse(),
          ]
        : navigationHistory.toReversed();
    const currentActiveId = context
      ? ((closed.placement === "primary"
          ? selectActiveSurface(current, context)
          : selectActiveAuxiliarySurface(current, context)
        )?.id ?? null)
      : activeSurfaceIdForPlacement(current, closed.placement);
    const nextActiveId =
      currentActiveId === surfaceId
        ? (adjacentSurfaceIds.find(matchesClosedPane) ?? null)
        : currentActiveId;
    const activeSurfaceId = closed.placement === "primary" ? nextActiveId : current.activeSurfaceId;
    const activeAuxiliarySurfaceId =
      closed.placement === "auxiliary" ? nextActiveId : current.activeAuxiliarySurfaceId;
    const hasActiveSurface = context
      ? nextActiveId !== null ||
        Boolean(
          closed.placement === "primary"
            ? selectActiveAuxiliarySurface(current, context)
            : selectActiveSurface(current, context),
        )
      : Boolean(activeSurfaceId || activeAuxiliarySurfaceId);
    this.setState(() => ({
      surfaces,
      surfaceOrder,
      navigationHistory,
      activeSurfaceId,
      activeAuxiliarySurfaceId,
      open: hasActiveSurface ? current.open : false,
    }));
  };

  closeToRight = (surfaceId: string, context: WorkspaceContext): void => {
    this.assertNotDisposed();
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
    this.assertNotDisposed();
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
    this.assertNotDisposed();
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
    this.assertNotDisposed();
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

  promoteThreadScope = (fromThreadKey: string, nextContext: WorkspaceContext): void => {
    this.assertNotDisposed();
    if (fromThreadKey.trim().length === 0) {
      throw new Error("RightWorkspace thread promotion requires a non-empty source thread key");
    }
    const nextThreadKey = nextContext.threadId;
    if (!nextThreadKey || nextThreadKey.trim().length === 0) {
      throw new Error("RightWorkspace thread promotion requires nextContext.threadId");
    }
    if (fromThreadKey === nextThreadKey) return;

    const current = this.#store.getState();
    const knownSurfaceIds = new Set(current.surfaceOrder);
    const orderedSurfaceIds = [
      ...current.surfaceOrder,
      ...Object.keys(current.surfaces)
        .filter((surfaceId) => !knownSurfaceIds.has(surfaceId))
        .sort(),
    ];
    const promotedSurfaces = new Map<string, WorkspaceSurfaceInstance>();
    const nonDuplicateWinners = new Map<string, Map<string, string>>();

    // Resolve every new key before entering setState. A contribution error therefore cannot leave
    // a partially promoted scope. Temporarily unavailable definitions retain their opaque key;
    // Shell cannot safely reverse-engineer a contribution-owned identity.
    for (const surfaceId of orderedSurfaceIds) {
      const surface = current.surfaces[surfaceId];
      if (!surface || surface.scope.type !== "thread" || surface.scope.key !== fromThreadKey) {
        continue;
      }
      const definition = this.#registry.get(surface.kind);
      const resourceKey = definition
        ? definition.getResourceKey(surface.params, nextContext)
        : surface.resourceKey;
      promotedSurfaces.set(surfaceId, {
        ...surface,
        resourceKey,
        scope: { type: "thread", key: nextThreadKey },
      });
      if (definition?.allowDuplicateResources === true) continue;
      if (!definition) continue;
      let winnersByResourceKey = nonDuplicateWinners.get(surface.kind);
      if (!winnersByResourceKey) {
        winnersByResourceKey = new Map();
        nonDuplicateWinners.set(surface.kind, winnersByResourceKey);
      }
      // orderedSurfaceIds makes the first promoted instance in surfaceOrder deterministic.
      if (!winnersByResourceKey.has(resourceKey)) {
        winnersByResourceKey.set(resourceKey, surfaceId);
      }
    }
    if (promotedSurfaces.size === 0) return;

    const projectedSurfaces: Record<string, WorkspaceSurfaceInstance> = {
      ...current.surfaces,
      ...Object.fromEntries(promotedSurfaces),
    };
    const loserToWinner = new Map<string, string>();
    for (const [kind, winnersByResourceKey] of nonDuplicateWinners) {
      for (const [resourceKey, winnerId] of winnersByResourceKey) {
        for (const candidateId of orderedSurfaceIds) {
          const candidate = projectedSurfaces[candidateId];
          if (
            candidateId !== winnerId &&
            candidate?.kind === kind &&
            candidate.resourceKey === resourceKey
          ) {
            loserToWinner.set(candidateId, winnerId);
          }
        }
      }
    }

    const surfaces = { ...projectedSurfaces };
    for (const loserId of loserToWinner.keys()) delete surfaces[loserId];
    const surfaceOrder = current.surfaceOrder.filter((surfaceId) => !loserToWinner.has(surfaceId));

    // Mapping before de-duplication preserves the most recent surviving history occurrence.
    const navigationHistory: string[] = [];
    for (const previousId of current.navigationHistory) {
      const surfaceId = loserToWinner.get(previousId) ?? previousId;
      if (!surfaces[surfaceId]) continue;
      const previousIndex = navigationHistory.indexOf(surfaceId);
      if (previousIndex >= 0) navigationHistory.splice(previousIndex, 1);
      navigationHistory.push(surfaceId);
    }

    const resolveActiveId = (
      activeId: string | null,
      placement: WorkspaceSurfacePlacement,
    ): string | null => {
      if (!activeId) return null;
      const replacementId = loserToWinner.get(activeId);
      const retainedId = replacementId ?? activeId;
      if (surfaces[retainedId]?.placement === placement) return retainedId;
      if (!replacementId) return null;

      const closedSurface = projectedSurfaces[activeId];
      if (!closedSurface) return null;
      const closedIndex = current.surfaceOrder.indexOf(activeId);
      const adjacentSurfaceIds =
        closedIndex >= 0
          ? [
              ...current.surfaceOrder.slice(closedIndex + 1),
              ...current.surfaceOrder.slice(0, closedIndex).reverse(),
            ]
          : current.navigationHistory.toReversed();
      for (const candidateId of adjacentSurfaceIds) {
        const retainedCandidateId = loserToWinner.get(candidateId) ?? candidateId;
        const candidate = surfaces[retainedCandidateId];
        if (candidate?.placement === placement && sameScope(candidate.scope, closedSurface.scope)) {
          return retainedCandidateId;
        }
      }
      return null;
    };

    this.setState(() => ({
      surfaces,
      surfaceOrder,
      navigationHistory,
      activeSurfaceId: resolveActiveId(current.activeSurfaceId, "primary"),
      activeAuxiliarySurfaceId: resolveActiveId(current.activeAuxiliarySurfaceId, "auxiliary"),
    }));
  };

  resetLayout = (): void => {
    this.assertNotDisposed();
    this.setState(() => ({
      open: false,
      width: DEFAULT_RIGHT_WORKSPACE_WIDTH,
      maximized: false,
    }));
  };

  setWorkspaceOpen = (open: boolean): void => {
    this.assertNotDisposed();
    this.setState(() => ({ open }));
  };

  setWidth = (width: number): void => {
    this.assertNotDisposed();
    if (!Number.isFinite(width)) return;
    this.setState(() => ({ width: Math.max(MIN_RIGHT_WORKSPACE_WIDTH, width) }));
  };

  setAuxiliaryOpen = (open: boolean): void => {
    this.assertNotDisposed();
    this.setState(() => ({ auxiliaryOpen: open }));
  };

  setAuxiliaryWidth = (width: number): void => {
    this.assertNotDisposed();
    if (!Number.isFinite(width)) return;
    this.setState(() => ({
      auxiliaryWidth: Math.max(MIN_AUXILIARY_SURFACE_WIDTH, width),
    }));
  };

  setMaximized = (maximized: boolean): void => {
    this.assertNotDisposed();
    this.setState(() => ({ maximized }));
  };

  restore = (scope: WorkspaceScope): void => {
    this.assertNotDisposed();
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
    this.assertNotDisposed();
    const state = this.#store.getState();
    const activeSurfaceId = selectActiveSurface(state, context)?.id ?? null;
    const activeAuxiliarySurfaceId = selectActiveAuxiliarySurface(state, context)?.id ?? null;
    if (
      state.activeSurfaceId === activeSurfaceId &&
      state.activeAuxiliarySurfaceId === activeAuxiliarySurfaceId
    ) {
      return;
    }
    this.setState(() => ({ activeSurfaceId, activeAuxiliarySurfaceId }));
  };

  initialize = (): Promise<void> => {
    this.assertNotDisposed();
    this.#initialization ??= this.initializeOnce();
    return this.#initialization;
  };

  dispose = (): void => {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#persistenceActive = false;
    this.#persistence = undefined;
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
    this.assertNotDisposed();
    this.#store.setState((state) => {
      const patch = recipe(state);
      this.#mutationRevision += 1;
      return { ...state, ...patch };
    }, true);
    void this.enqueuePersistedState();
  }

  private async initializeOnce(): Promise<void> {
    const persistence = this.#persistence;
    if (!persistence) {
      if (!this.#disposed) {
        this.#store.setState((state) => ({ ...state, hydrated: true }), true);
      }
      return;
    }

    let serialized: string | null;
    try {
      serialized = await persistence.read();
    } catch {
      if (this.#disposed) return;
      this.#store.setState((state) => ({ ...state, hydrated: true }), true);
      // A failed read leaves the remote snapshot unknown. Keep persistence closed for this
      // installation so a later local mutation cannot replace unseen surfaces with a full
      // default/local snapshot. A fresh installation may retry the authoritative read.
      return;
    }

    if (this.#disposed) return;
    const persisted = parsePersistedState(
      serialized,
      this.#registry,
      this.#validateLocalizableText,
    );
    const restored =
      this.#mutationRevision === this.#initialMutationRevision ? persisted : undefined;
    this.#store.setState((state) => ({ ...state, ...restored, hydrated: true }), true);
    if (serialized !== null && persisted === undefined) {
      // A non-empty payload with an unknown root shape may belong to a newer schema. Do not
      // normalize it to defaults or enable later full-snapshot writes for this installation.
      return;
    }
    this.#persistenceActive = true;
    await this.enqueuePersistedState();
  }

  private enqueuePersistedState(): Promise<void> {
    const persistence = this.#persistence;
    if (!persistence || !this.#persistenceActive || this.#disposed) return Promise.resolve();

    let serialized: string;
    try {
      serialized = JSON.stringify(persistedState(this.#store.getState(), this.#registry));
    } catch {
      return Promise.resolve();
    }

    const operation = this.#writeTail.then(async () => {
      if (this.#disposed || !this.#persistenceActive || this.#persistence !== persistence) return;
      try {
        await persistence.write(serialized);
      } catch {
        // RightWorkspace state remains live when best-effort persistence fails.
      }
    });
    this.#writeTail = operation;
    return operation;
  }

  private assertNotDisposed(): void {
    if (this.#disposed) throw new RightWorkspaceControllerDisposedError();
  }
}
