import { createDisposable } from "../api/disposable";
import type { PanelDefinition, PanelRegistry } from "../api/panel";
import { assertNonEmptyId, emitRegistryChange } from "./registry-utils";

const EMPTY_PANELS = Object.freeze([]) as readonly PanelDefinition[];

export class PanelRegistryImpl implements PanelRegistry {
  readonly #panels = new Map<string, PanelDefinition>();
  readonly #listeners = new Set<() => void>();
  #snapshot = EMPTY_PANELS;

  register(panel: PanelDefinition) {
    assertNonEmptyId(panel.id, "Panel id");
    if (this.#panels.has(panel.id)) {
      throw new Error(`Panel "${panel.id}" is already registered`);
    }
    if (typeof panel.title === "string" && panel.title.trim().length === 0) {
      throw new Error(`Panel "${panel.id}" has an empty title`);
    }
    if (panel.title === undefined && panel.tabComponent === undefined) {
      throw new Error(`Panel "${panel.id}" must define a title or tabComponent`);
    }
    if (panel.minSize !== undefined && panel.maxSize !== undefined) {
      if (panel.minSize > panel.maxSize) {
        throw new Error(`Panel "${panel.id}" has a minSize greater than maxSize`);
      }
    }

    const stored = Object.freeze({
      ...panel,
      tabClassNames: panel.tabClassNames ? Object.freeze({ ...panel.tabClassNames }) : undefined,
    });
    this.#panels.set(panel.id, stored);
    this.#updateSnapshot();

    return createDisposable(() => {
      if (this.#panels.get(panel.id) !== stored) return;
      this.#panels.delete(panel.id);
      this.#updateSnapshot();
    });
  }

  get(panelId: string): PanelDefinition | undefined {
    return this.#panels.get(panelId);
  }

  getAll(): readonly PanelDefinition[] {
    return this.#snapshot;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #updateSnapshot(): void {
    this.#snapshot = Object.freeze(Array.from(this.#panels.values()));
    emitRegistryChange(this.#listeners);
  }
}
