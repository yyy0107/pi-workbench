import type { HostObservable } from "@workbench/agent-runtime-core";

export class MutableObservable<T> implements HostObservable<T> {
  readonly #listeners = new Set<() => void>();
  private value: T;

  constructor(value: T) {
    this.value = value;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): T => this.value;

  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const listener of this.#listeners) listener();
  }
}
