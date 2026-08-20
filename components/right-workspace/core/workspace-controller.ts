import {
  WORKSPACE_SCOPE_TYPES,
  type OpenSurfaceRequest,
  type PersistedRightWorkspaceState,
  type RightWorkspaceState,
  type WorkspaceContext,
  type WorkspaceScope,
  type WorkspaceSurfaceInstance,
  type WorkspaceSurfaceRegistry,
} from "./surface-types";
import { scopeMatchesContext } from "./workspace-selectors";
import {
  DEFAULT_RIGHT_WORKSPACE_WIDTH,
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
  close(surfaceId: string): void;
  closeOthers(surfaceId: string): void;
  closeAll(): void;
  update(surfaceId: string, patch: Partial<WorkspaceSurfaceInstance>): void;
  setWorkspaceOpen(open: boolean): void;
  setWidth(width: number): void;
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

function persistedState(state: RightWorkspaceState): PersistedRightWorkspaceState {
  return {
    open: state.open,
    width: state.width,
    activeSurfaceId: state.activeSurfaceId,
    surfaceOrder: [...state.surfaceOrder],
    surfaces: state.surfaceOrder.flatMap((id) => (state.surfaces[id] ? [state.surfaces[id]] : [])),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSurface(value: unknown): value is WorkspaceSurfaceInstance {
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

function parsePersistedState(serialized: string | null): Partial<RightWorkspaceState> | undefined {
  if (!serialized) return undefined;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value) || !Array.isArray(value.surfaces)) return undefined;
    const surfaces = value.surfaces.filter((surface) => isSurface(surface));
    const byId = Object.fromEntries(surfaces.map((surface) => [surface.id, surface]));
    const requestedOrder = Array.isArray(value.surfaceOrder)
      ? value.surfaceOrder.filter((id): id is string => typeof id === "string" && id in byId)
      : [];
    const surfaceOrder = [
      ...requestedOrder,
      ...surfaces.map((surface) => surface.id).filter((id) => !requestedOrder.includes(id)),
    ];
    const activeSurfaceId =
      typeof value.activeSurfaceId === "string" && value.activeSurfaceId in byId
        ? value.activeSurfaceId
        : (surfaceOrder.at(-1) ?? null);
    return {
      open: value.open === true,
      width:
        typeof value.width === "number" && Number.isFinite(value.width)
          ? Math.max(MIN_RIGHT_WORKSPACE_WIDTH, value.width)
          : DEFAULT_RIGHT_WORKSPACE_WIDTH,
      activeSurfaceId,
      surfaceOrder,
      surfaces: byId,
      navigationHistory: activeSurfaceId ? [activeSurfaceId] : [],
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
    const resourceKey = definition.getResourceKey(request.params, request.context);
    if (!definition.allowDuplicateResources) {
      const existing = Object.values(this.#store.getState().surfaces).find(
        (surface) => surface.kind === request.kind && surface.resourceKey === resourceKey,
      );
      if (existing) {
        this.applyOpenPolicy(existing.id, request.policy ?? "force-focus");
        return existing.id;
      }
    }

    const id = createSurfaceId(request.kind);
    const now = Date.now();
    const surface: WorkspaceSurfaceInstance = {
      id,
      kind: request.kind,
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
    this.setState((state) => ({
      surfaces: { ...state.surfaces, [id]: surface },
      surfaceOrder: [...state.surfaceOrder, id],
      activeSurfaceId:
        policy === "background" && state.activeSurfaceId ? state.activeSurfaceId : id,
      navigationHistory:
        policy === "background" && state.activeSurfaceId
          ? state.navigationHistory
          : pushHistory(state.navigationHistory, id),
      open: policy === "background" ? state.open : true,
    }));
    return id;
  };

  reveal = <P extends Record<string, unknown>>(request: OpenSurfaceRequest<P>): string => {
    const definition = this.#registry.get(request.kind);
    if (!definition) throw new Error(`Workspace surface "${request.kind}" is not registered`);
    const resourceKey = definition.getResourceKey(request.params, request.context);
    const existing = Object.values(this.#store.getState().surfaces).find(
      (surface) => surface.kind === request.kind && surface.resourceKey === resourceKey,
    );
    if (!existing) return this.open({ ...request, policy: request.policy ?? "reveal" });

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
    if (!this.#store.getState().surfaces[surfaceId]) return;
    const now = Date.now();
    this.setState((state) => ({
      activeSurfaceId: surfaceId,
      open: true,
      navigationHistory: pushHistory(state.navigationHistory, surfaceId),
      surfaces: {
        ...state.surfaces,
        [surfaceId]: { ...state.surfaces[surfaceId], lastActiveAt: now },
      },
    }));
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
    const closedScope = current.surfaces[surfaceId].scope;
    const sameScope = (candidate: string) => {
      const candidateSurface = surfaces[candidate];
      return (
        candidateSurface?.scope.type === closedScope.type &&
        candidateSurface.scope.key === closedScope.key
      );
    };
    const activeSurfaceId =
      current.activeSurfaceId === surfaceId
        ? (navigationHistory.findLast(sameScope) ?? surfaceOrder.findLast(sameScope) ?? null)
        : current.activeSurfaceId;
    this.setState(() => ({
      surfaces,
      surfaceOrder,
      navigationHistory,
      activeSurfaceId,
      open: activeSurfaceId ? current.open : false,
    }));
  };

  closeOthers = (surfaceId: string): void => {
    const current = this.#store.getState();
    const surface = current.surfaces[surfaceId];
    if (!surface) return;
    this.setState(() => ({
      surfaces: { [surfaceId]: surface },
      surfaceOrder: [surfaceId],
      navigationHistory: [surfaceId],
      activeSurfaceId: surfaceId,
      open: true,
    }));
  };

  closeAll = (): void => {
    this.setState(() => ({
      surfaces: {},
      surfaceOrder: [],
      navigationHistory: [],
      activeSurfaceId: null,
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

  setMaximized = (maximized: boolean): void => {
    this.setState(() => ({ maximized }));
  };

  restore = (scope: WorkspaceScope): void => {
    const state = this.#store.getState();
    const next = state.surfaceOrder
      .map((id) => state.surfaces[id])
      .filter((surface): surface is WorkspaceSurfaceInstance => Boolean(surface))
      .filter((surface) => surface.scope.type === scope.type && surface.scope.key === scope.key)
      .sort((left, right) => left.lastActiveAt - right.lastActiveAt)
      .at(-1);
    if (!next || state.activeSurfaceId === next.id) return;
    this.setState((current) => ({
      activeSurfaceId: next.id,
      navigationHistory: pushHistory(current.navigationHistory, next.id),
    }));
  };

  restoreContext = (context: WorkspaceContext): void => {
    const state = this.#store.getState();
    const active = state.activeSurfaceId ? state.surfaces[state.activeSurfaceId] : undefined;
    if (active && scopeMatchesContext(active.scope, context)) return;
    const next = state.surfaceOrder
      .map((id) => state.surfaces[id])
      .filter((surface): surface is WorkspaceSurfaceInstance => Boolean(surface))
      .filter((surface) => scopeMatchesContext(surface.scope, context))
      .sort((left, right) => left.lastActiveAt - right.lastActiveAt)
      .at(-1);
    this.setState(() => ({ activeSurfaceId: next?.id ?? null }));
  };

  hydrate = (storage: WorkspaceStorage): void => {
    this.#storage = storage;
    const restored = parsePersistedState(storage.getItem(RIGHT_WORKSPACE_STORAGE_KEY));
    this.#store.setState((state) => ({ ...state, ...restored, hydrated: true }), true);
    this.persist();
  };

  private applyOpenPolicy(surfaceId: string, policy: NonNullable<OpenSurfaceRequest["policy"]>) {
    if (policy === "background") return;
    this.focus(surfaceId);
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
