import type {
  DataRendererComponent,
  MessageRendererContribution,
  MessageRendererRegistry,
  NamedRendererRegistry,
  RendererRegistry,
  ToolPresentationDefinition,
  ToolPresentationRegistry,
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

class MessageRendererRegistryImpl implements MessageRendererRegistry {
  readonly #listeners = new Set<() => void>();
  #contribution: MessageRendererContribution | undefined;

  register(contribution: MessageRendererContribution) {
    assertNonEmptyId(contribution.id, "Message renderer id");
    if (this.#contribution) {
      throw new Error(
        `Message renderer "${this.#contribution.id}" is already registered; dispose it before registering "${contribution.id}"`,
      );
    }

    const snapshot = Object.freeze({ ...contribution });
    this.#contribution = snapshot;
    emitRegistryChange(this.#listeners);

    return createDisposable(() => {
      if (this.#contribution !== snapshot) return;
      this.#contribution = undefined;
      emitRegistryChange(this.#listeners);
    });
  }

  get(): MessageRendererContribution | undefined {
    return this.#contribution;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
}

class ToolPresentationRegistryImpl implements ToolPresentationRegistry {
  readonly #presentations = new Map<string, ToolPresentationDefinition>();
  readonly #listeners = new Set<() => void>();
  #snapshot: Readonly<Record<string, ToolPresentationDefinition>> = EMPTY_COMPONENT_MAP;

  register(toolName: string, presentation: ToolPresentationDefinition) {
    assertNonEmptyId(toolName, "Tool presentation name");
    if (this.#presentations.has(toolName)) {
      throw new Error(`Tool presentation "${toolName}" is already registered`);
    }

    const registered = Object.freeze({ ...presentation });
    this.#presentations.set(toolName, registered);
    this.#updateSnapshot();

    return createDisposable(() => {
      if (this.#presentations.get(toolName) !== registered) return;
      this.#presentations.delete(toolName);
      this.#updateSnapshot();
    });
  }

  get(toolName: string): ToolPresentationDefinition | undefined {
    return this.#presentations.get(toolName);
  }

  getPresentationMap(): Readonly<Record<string, ToolPresentationDefinition>> {
    return this.#snapshot;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #updateSnapshot(): void {
    const snapshot = Object.create(null) as Record<string, ToolPresentationDefinition>;
    for (const [name, presentation] of this.#presentations) snapshot[name] = presentation;
    this.#snapshot = Object.freeze(snapshot);
    emitRegistryChange(this.#listeners);
  }
}

export class RendererRegistryImpl implements RendererRegistry {
  readonly message: MessageRendererRegistry = new MessageRendererRegistryImpl();
  readonly tools: NamedRendererRegistry<ToolRendererComponent> =
    new NamedRendererRegistryImpl<ToolRendererComponent>("Tool");
  readonly data: NamedRendererRegistry<DataRendererComponent> =
    new NamedRendererRegistryImpl<DataRendererComponent>("Data");
  readonly toolPresentations: ToolPresentationRegistry = new ToolPresentationRegistryImpl();
}
