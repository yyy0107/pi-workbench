import { createDisposable } from "../api/disposable";
import type { OpenHandlerDefinition, OpenerRegistry } from "../api/opener";
import { assertNonEmptyId, emitRegistryChange } from "./registry-utils";

const EMPTY_HANDLERS = Object.freeze([]) as readonly OpenHandlerDefinition[];

export class OpenerRegistryImpl implements OpenerRegistry {
  readonly #handlers = new Map<string, OpenHandlerDefinition>();
  readonly #listeners = new Set<() => void>();
  #snapshot = EMPTY_HANDLERS;

  register(handler: OpenHandlerDefinition) {
    assertNonEmptyId(handler.id, "Open handler id");
    if (this.#handlers.has(handler.id)) {
      throw new Error(`Open handler "${handler.id}" is already registered`);
    }

    const stored = Object.freeze({ ...handler });
    this.#handlers.set(handler.id, stored);
    this.#updateSnapshot();

    return createDisposable(() => {
      if (this.#handlers.get(handler.id) !== stored) return;
      this.#handlers.delete(handler.id);
      this.#updateSnapshot();
    });
  }

  getAll(): readonly OpenHandlerDefinition[] {
    return this.#snapshot;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #updateSnapshot(): void {
    this.#snapshot = Object.freeze(Array.from(this.#handlers.values()));
    emitRegistryChange(this.#listeners);
  }
}
