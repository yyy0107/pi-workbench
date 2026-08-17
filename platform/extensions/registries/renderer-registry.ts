import type {
  DataRendererComponent,
  NamedRendererRegistry,
  RendererRegistry,
  ToolRendererComponent,
} from "../api/renderer";
import { createDisposable } from "../api/disposable";
import { assertNonEmptyId, emitRegistryChange } from "./registry-utils";

const EMPTY_COMPONENT_MAP = Object.freeze(Object.create(null));

class NamedRendererRegistryImpl<TComponent> implements NamedRendererRegistry<TComponent> {
  readonly #kind: string;
  readonly #components = new Map<string, TComponent>();
  readonly #listeners = new Set<() => void>();
  #snapshot: Readonly<Record<string, TComponent>> = EMPTY_COMPONENT_MAP;

  constructor(kind: string) {
    this.#kind = kind;
  }

  register(name: string, component: TComponent) {
    assertNonEmptyId(name, `${this.#kind} renderer name`);
    if (this.#components.has(name)) {
      throw new Error(`${this.#kind} renderer "${name}" is already registered`);
    }

    this.#components.set(name, component);
    this.#updateSnapshot();

    return createDisposable(() => {
      if (this.#components.get(name) !== component) return;
      this.#components.delete(name);
      this.#updateSnapshot();
    });
  }

  get(name: string): TComponent | undefined {
    return this.#components.get(name);
  }

  getComponentMap(): Readonly<Record<string, TComponent>> {
    return this.#snapshot;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #updateSnapshot(): void {
    const snapshot = Object.create(null) as Record<string, TComponent>;
    for (const [name, component] of this.#components) snapshot[name] = component;
    this.#snapshot = Object.freeze(snapshot);
    emitRegistryChange(this.#listeners);
  }
}

export class RendererRegistryImpl implements RendererRegistry {
  readonly tools: NamedRendererRegistry<ToolRendererComponent> =
    new NamedRendererRegistryImpl<ToolRendererComponent>("Tool");
  readonly data: NamedRendererRegistry<DataRendererComponent> =
    new NamedRendererRegistryImpl<DataRendererComponent>("Data");
}
