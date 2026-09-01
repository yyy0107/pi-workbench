import type { PanelDefinition, PanelLocation, PanelRegistry } from "@workbench/extension-sdk";

/**
 * Host-owned contract for panel state. Applications choose persistence and state libraries, while
 * the extension host only requires the panel operations it coordinates with registered panels.
 */
export interface PanelStoreState {
  readonly openedPanelIds: readonly string[];
  readonly activeByLocation: Partial<Record<PanelLocation, string>>;
  readonly collapsedByLocation: Partial<Record<PanelLocation, boolean>>;
  readonly locationByPanelId: Readonly<Record<string, PanelLocation>>;
  readonly sizeByLocation: Partial<Record<PanelLocation, number>>;
  open(panelId: string, location?: PanelLocation): void;
  close(panelId: string): void;
  toggle(panelId: string, location?: PanelLocation): void;
  activate(panelId: string): void;
  move(panelId: string, location: PanelLocation): void;
  collapse(location: PanelLocation): void;
  expand(location: PanelLocation): void;
  setSize(location: PanelLocation, size: number): void;
}

export interface PanelStorePort {
  getState(): PanelStoreState;
  getInitialState(): PanelStoreState;
  subscribe(listener: () => void): () => void;
}

export class PanelService {
  readonly #registry: PanelRegistry;
  readonly #store: PanelStorePort;

  constructor(registry: PanelRegistry, store: PanelStorePort) {
    this.#registry = registry;
    this.#store = store;
  }

  readonly open = (panelId: string): void => {
    const definition = this.#requirePanel(panelId);
    const state = this.#store.getState();
    const location = state.locationByPanelId[panelId] ?? definition.defaultLocation;

    state.open(panelId, location);
    if (state.sizeByLocation[location] === undefined && definition.defaultSize !== undefined) {
      this.setSize(location, definition.defaultSize);
    }
  };

  readonly close = (panelId: string): void => {
    this.#store.getState().close(panelId);
  };

  readonly toggle = (panelId: string): void => {
    if (this.isOpen(panelId)) this.close(panelId);
    else this.open(panelId);
  };

  readonly activate = (panelId: string): void => {
    this.#requirePanel(panelId);
    this.#store.getState().activate(panelId);
  };

  readonly move = (panelId: string, location: PanelLocation): void => {
    this.#requirePanel(panelId);
    this.#store.getState().move(panelId, location);
  };

  readonly collapse = (location: PanelLocation): void => {
    this.#store.getState().collapse(location);
  };

  readonly expand = (location: PanelLocation): void => {
    this.#store.getState().expand(location);
  };

  readonly setSize = (location: PanelLocation, size: number): void => {
    const activePanelId = this.getActivePanelId(location);
    const definition = activePanelId ? this.#registry.get(activePanelId) : undefined;
    const minimum = definition?.minSize ?? 0;
    const maximum = definition?.maxSize ?? Number.POSITIVE_INFINITY;
    const clamped = Math.min(maximum, Math.max(minimum, size));
    this.#store.getState().setSize(location, clamped);
  };

  readonly isOpen = (panelId: string): boolean => {
    return this.#store.getState().openedPanelIds.includes(panelId);
  };

  readonly getActivePanelId = (location: PanelLocation): string | undefined => {
    return this.#store.getState().activeByLocation[location];
  };

  readonly getSize = (location: PanelLocation): number | undefined => {
    const state = this.#store.getState();
    const configured = state.sizeByLocation[location];
    if (configured !== undefined) return configured;

    const activePanelId = state.activeByLocation[location];
    return activePanelId ? this.#registry.get(activePanelId)?.defaultSize : undefined;
  };

  readonly getLocation = (panelId: string): PanelLocation | undefined => {
    return this.#store.getState().locationByPanelId[panelId];
  };

  readonly isCollapsed = (location: PanelLocation): boolean => {
    return this.#store.getState().collapsedByLocation[location] === true;
  };

  readonly getSnapshot = (): PanelStoreState => this.#store.getState();

  readonly getInitialSnapshot = (): PanelStoreState => this.#store.getInitialState();

  readonly subscribe = (listener: () => void): (() => void) => {
    return this.#store.subscribe(listener);
  };

  #requirePanel(panelId: string): PanelDefinition {
    const definition = this.#registry.get(panelId);
    if (!definition) throw new Error(`Unknown panel "${panelId}"`);
    return definition;
  }
}
