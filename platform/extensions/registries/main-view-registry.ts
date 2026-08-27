import { createDisposable } from "../api/disposable";
import type { AnyMainViewDefinition, MainViewDefinition, MainViewRegistry } from "../api/main-view";
import { assertNonEmptyId, emitRegistryChange } from "./registry-utils";

const EMPTY_MAIN_VIEWS = Object.freeze([]) as readonly AnyMainViewDefinition[];

export class MainViewRegistryImpl implements MainViewRegistry {
  readonly #definitions = new Map<string, AnyMainViewDefinition>();
  readonly #listeners = new Set<() => void>();
  #snapshot = EMPTY_MAIN_VIEWS;

  register<P extends Record<string, unknown>>(definition: MainViewDefinition<P>) {
    assertNonEmptyId(definition.kind, "Main view kind");
    if (this.#definitions.has(definition.kind)) {
      throw new Error(`Main view "${definition.kind}" is already registered`);
    }

    const stored = Object.freeze({
      ...definition,
      ...(definition.chrome ? { chrome: Object.freeze({ ...definition.chrome }) } : {}),
    }) as unknown as AnyMainViewDefinition;
    this.#definitions.set(definition.kind, stored);
    this.#updateSnapshot();

    return createDisposable(() => {
      if (this.#definitions.get(definition.kind) !== stored) return;
      this.#definitions.delete(definition.kind);
      this.#updateSnapshot();
    });
  }

  get(kind: string): AnyMainViewDefinition | undefined {
    return this.#definitions.get(kind);
  }

  getAll(): readonly AnyMainViewDefinition[] {
    return this.#snapshot;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #updateSnapshot(): void {
    this.#snapshot = Object.freeze(Array.from(this.#definitions.values()));
    emitRegistryChange(this.#listeners);
  }
}
