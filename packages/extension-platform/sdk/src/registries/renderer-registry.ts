import type {
  DataPresentationDefinition,
  DataPresentationRegistry,
  DataRendererComponent,
  MessageBlockRendererContribution,
  MessageBlockRendererRegistry,
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
const EMPTY_BLOCK_RENDERERS = Object.freeze(
  [],
) as readonly Readonly<MessageBlockRendererContribution>[];

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

class MessageBlockRendererRegistryImpl implements MessageBlockRendererRegistry {
  readonly #contributions = new Map<string, Readonly<MessageBlockRendererContribution>>();
  readonly #listeners = new Set<() => void>();
  #snapshot = EMPTY_BLOCK_RENDERERS;

  register(contribution: MessageBlockRendererContribution) {
    assertNonEmptyId(contribution.id, "Message block renderer id");
    if (this.#contributions.has(contribution.id)) {
      throw new Error(`Message block renderer "${contribution.id}" is already registered`);
    }

    const registered = Object.freeze({ ...contribution });
    this.#contributions.set(registered.id, registered);
    this.#updateSnapshot();

    return createDisposable(() => {
      if (this.#contributions.get(registered.id) !== registered) return;
      this.#contributions.delete(registered.id);
      this.#updateSnapshot();
    });
  }

  getAll(): readonly Readonly<MessageBlockRendererContribution>[] {
    return this.#snapshot;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #updateSnapshot(): void {
    this.#snapshot = Object.freeze(Array.from(this.#contributions.values()));
    emitRegistryChange(this.#listeners);
  }
}

class NamedPresentationRegistryImpl<TPresentation extends object> {
  readonly #kind: string;
  readonly #presentations = new Map<string, Readonly<TPresentation>>();
  readonly #listeners = new Set<() => void>();
  #snapshot: Readonly<Record<string, Readonly<TPresentation>>> = EMPTY_COMPONENT_MAP;

  constructor(kind: string) {
    this.#kind = kind;
  }

  register(name: string, presentation: TPresentation) {
    assertNonEmptyId(name, `${this.#kind} presentation name`);
    if (this.#presentations.has(name)) {
      throw new Error(`${this.#kind} presentation "${name}" is already registered`);
    }

    const registered = Object.freeze({ ...presentation });
    this.#presentations.set(name, registered);
    this.#updateSnapshot();

    return createDisposable(() => {
      if (this.#presentations.get(name) !== registered) return;
      this.#presentations.delete(name);
      this.#updateSnapshot();
    });
  }

  get(name: string): Readonly<TPresentation> | undefined {
    return this.#presentations.get(name);
  }

  getPresentationMap(): Readonly<Record<string, Readonly<TPresentation>>> {
    return this.#snapshot;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #updateSnapshot(): void {
    const snapshot = Object.create(null) as Record<string, Readonly<TPresentation>>;
    for (const [name, presentation] of this.#presentations) snapshot[name] = presentation;
    this.#snapshot = Object.freeze(snapshot);
    emitRegistryChange(this.#listeners);
  }
}

export class RendererRegistryImpl implements RendererRegistry {
  readonly message: MessageRendererRegistry = new MessageRendererRegistryImpl();
  readonly blocks: MessageBlockRendererRegistry = new MessageBlockRendererRegistryImpl();
  readonly tools: NamedRendererRegistry<ToolRendererComponent> =
    new NamedRendererRegistryImpl<ToolRendererComponent>("Tool");
  readonly data: NamedRendererRegistry<DataRendererComponent> =
    new NamedRendererRegistryImpl<DataRendererComponent>("Data");
  readonly toolPresentations: ToolPresentationRegistry =
    new NamedPresentationRegistryImpl<ToolPresentationDefinition>("Tool");
  readonly dataPresentations: DataPresentationRegistry =
    new NamedPresentationRegistryImpl<DataPresentationDefinition>("Data");
}
