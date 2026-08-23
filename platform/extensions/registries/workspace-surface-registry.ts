import { createDisposable } from "../api/disposable";
import {
  WORKSPACE_SURFACE_PLACEMENTS,
  type AnyWorkspaceSurfaceDefinition,
  type WorkspaceSurfaceDefinition,
  type WorkspaceSurfaceRegistry,
} from "../api/workspace-surface";
import { assertNonEmptyId, emitRegistryChange } from "./registry-utils";

const EMPTY_SURFACES = Object.freeze([]) as readonly AnyWorkspaceSurfaceDefinition[];
const CACHE_POLICIES = new Set(["unmount", "keep-alive"]);
const SURFACE_PLACEMENTS = new Set(WORKSPACE_SURFACE_PLACEMENTS);

export class WorkspaceSurfaceRegistryImpl implements WorkspaceSurfaceRegistry {
  readonly #definitions = new Map<string, AnyWorkspaceSurfaceDefinition>();
  readonly #listeners = new Set<() => void>();
  #snapshot = EMPTY_SURFACES;

  register<P extends Record<string, unknown>>(definition: WorkspaceSurfaceDefinition<P>) {
    assertNonEmptyId(definition.kind, "Workspace surface kind");
    if (this.#definitions.has(definition.kind)) {
      throw new Error(`Workspace surface "${definition.kind}" is already registered`);
    }
    if (!CACHE_POLICIES.has(definition.cachePolicy)) {
      throw new Error(
        `Workspace surface "${definition.kind}" has invalid cache policy "${definition.cachePolicy}"`,
      );
    }
    if (definition.defaultPlacement && !SURFACE_PLACEMENTS.has(definition.defaultPlacement)) {
      throw new Error(
        `Workspace surface "${definition.kind}" has invalid default placement "${definition.defaultPlacement}"`,
      );
    }

    const stored = Object.freeze({ ...definition }) as unknown as AnyWorkspaceSurfaceDefinition;
    this.#definitions.set(definition.kind, stored);
    this.#updateSnapshot();

    return createDisposable(() => {
      if (this.#definitions.get(definition.kind) !== stored) return;
      this.#definitions.delete(definition.kind);
      this.#updateSnapshot();
    });
  }

  get(kind: string): AnyWorkspaceSurfaceDefinition | undefined {
    return this.#definitions.get(kind);
  }

  getAll(): readonly AnyWorkspaceSurfaceDefinition[] {
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
