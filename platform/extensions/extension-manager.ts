import type { CommandRegistry } from "./api/command";
import { disposeAll, type Disposable } from "./api/disposable";
import type { ExtensionContext, ExtensionSetupResult, WorkbenchExtension } from "./api/extension";
import type { PanelRegistry } from "./api/panel";
import type {
  DataRendererComponent,
  MessageRendererRegistry,
  NamedRendererRegistry,
  RendererRegistry,
  ToolRendererComponent,
} from "./api/renderer";
import type { SettingsRegistry } from "./api/settings";
import type { SlotContribution, SlotRegistry, WorkbenchSlot } from "./api/slot";
import { CommandRegistryImpl } from "./registries/command-registry";
import { PanelRegistryImpl } from "./registries/panel-registry";
import { RendererRegistryImpl } from "./registries/renderer-registry";
import { SettingsRegistryImpl } from "./registries/settings-registry";
import { SlotRegistryImpl } from "./registries/slot-registry";

interface ActiveExtension {
  readonly extension: WorkbenchExtension;
  readonly disposables: ReadonlySet<Disposable>;
}

const EMPTY_EXTENSIONS = Object.freeze([]) as readonly WorkbenchExtension[];

export class ExtensionManager implements Disposable {
  readonly slots: SlotRegistry = new SlotRegistryImpl();
  readonly panels: PanelRegistry = new PanelRegistryImpl();
  readonly commands: CommandRegistry = new CommandRegistryImpl();
  readonly renderers: RendererRegistry = new RendererRegistryImpl();
  readonly settings: SettingsRegistry = new SettingsRegistryImpl();

  readonly #active = new Map<string, ActiveExtension>();
  readonly #listeners = new Set<() => void>();
  #snapshot = EMPTY_EXTENSIONS;

  activate(extension: WorkbenchExtension): Disposable {
    this.#assertExtension(extension);
    if (this.#active.has(extension.id)) {
      throw new Error(`Extension "${extension.id}" is already active`);
    }

    const disposables = new Set<Disposable>();
    const context = this.#createTrackedContext(disposables);

    try {
      this.#trackSetupResult(extension.setup(context), disposables);
    } catch (error) {
      try {
        disposeAll(disposables);
      } catch (disposeError) {
        throw new AggregateError(
          [error, disposeError],
          `Extension "${extension.id}" setup and rollback both failed`,
        );
      }
      throw error;
    }

    const active: ActiveExtension = { extension, disposables };
    this.#active.set(extension.id, active);
    this.#updateSnapshot();

    return {
      dispose: () => {
        if (this.#active.get(extension.id) !== active) return;
        this.deactivate(extension.id);
      },
    };
  }

  deactivate(extensionId: string): void {
    const active = this.#active.get(extensionId);
    if (!active) return;

    this.#active.delete(extensionId);
    this.#updateSnapshot();
    disposeAll(active.disposables);
  }

  replaceExtensions(extensions: readonly WorkbenchExtension[]): void {
    const nextById = new Map<string, WorkbenchExtension>();
    for (const extension of extensions) {
      this.#assertExtension(extension);
      if (nextById.has(extension.id)) {
        throw new Error(`Duplicate extension id "${extension.id}"`);
      }
      nextById.set(extension.id, extension);
    }

    for (const [extensionId, active] of this.#active) {
      const next = nextById.get(extensionId);
      if (!next || next !== active.extension) this.deactivate(extensionId);
    }

    for (const extension of extensions) {
      if (!this.#active.has(extension.id)) this.activate(extension);
    }
  }

  isActive(extensionId: string): boolean {
    return this.#active.has(extensionId);
  }

  getExtensions(): readonly WorkbenchExtension[] {
    return this.#snapshot;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  dispose(): void {
    const errors: unknown[] = [];
    for (const extensionId of Array.from(this.#active.keys()).reverse()) {
      try {
        this.deactivate(extensionId);
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "Multiple extensions failed to dispose");
    }
  }

  #createTrackedContext(disposables: Set<Disposable>): ExtensionContext {
    const track = <TDisposable extends Disposable>(disposable: TDisposable): TDisposable => {
      disposables.add(disposable);
      return disposable;
    };

    const slots: SlotRegistry = {
      register: <K extends WorkbenchSlot>(slot: K, contribution: SlotContribution<K>) =>
        track(this.slots.register(slot, contribution)),
      get: <K extends WorkbenchSlot>(slot: K) => this.slots.get(slot),
      subscribe: this.slots.subscribe,
    };

    const panels: PanelRegistry = {
      register: (panel) => track(this.panels.register(panel)),
      get: (panelId) => this.panels.get(panelId),
      getAll: () => this.panels.getAll(),
      subscribe: this.panels.subscribe,
    };

    const commands: CommandRegistry = {
      register: (command) => track(this.commands.register(command)),
      get: (commandId) => this.commands.get(commandId),
      getAll: () => this.commands.getAll(),
      subscribe: this.commands.subscribe,
    };

    const wrapRenderers = <TComponent>(
      registry: NamedRendererRegistry<TComponent>,
    ): NamedRendererRegistry<TComponent> => ({
      register: (name, component) => track(registry.register(name, component)),
      get: (name) => registry.get(name),
      getComponentMap: () => registry.getComponentMap(),
      subscribe: registry.subscribe,
    });

    const renderers: RendererRegistry = {
      message: {
        register: (contribution) => track(this.renderers.message.register(contribution)),
        get: () => this.renderers.message.get(),
        subscribe: this.renderers.message.subscribe,
      } satisfies MessageRendererRegistry,
      tools: wrapRenderers<ToolRendererComponent>(this.renderers.tools),
      data: wrapRenderers<DataRendererComponent>(this.renderers.data),
    };

    const settings: SettingsRegistry = {
      registerSection: (section) => track(this.settings.registerSection(section)),
      registerItem: (item) => track(this.settings.registerItem(item)),
      getSections: () => this.settings.getSections(),
      getItems: () => this.settings.getItems(),
      subscribe: this.settings.subscribe,
    };

    return Object.freeze({ slots, panels, commands, renderers, settings });
  }

  #trackSetupResult(result: ExtensionSetupResult, disposables: Set<Disposable>): void {
    if (!result) return;
    if (Array.isArray(result)) {
      for (const disposable of result) disposables.add(disposable);
      return;
    }
    disposables.add(result as Disposable);
  }

  #assertExtension(extension: WorkbenchExtension): void {
    if (extension.id.trim().length === 0) {
      throw new Error("Extension id must be a non-empty string");
    }
    if (extension.name.trim().length === 0) {
      throw new Error(`Extension "${extension.id}" must have a name`);
    }
    if (extension.version.trim().length === 0) {
      throw new Error(`Extension "${extension.id}" must have a version`);
    }
  }

  #updateSnapshot(): void {
    this.#snapshot = Object.freeze(Array.from(this.#active.values(), ({ extension }) => extension));
    for (const listener of this.#listeners) listener();
  }
}
