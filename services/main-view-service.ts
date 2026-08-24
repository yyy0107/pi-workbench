import type {
  MainViewInstance,
  MainViewRegistry,
  OpenMainViewRequest,
} from "@/platform/extensions/api/main-view";

export class MainViewService {
  readonly #registry: MainViewRegistry;
  readonly #listeners = new Set<() => void>();
  readonly #unsubscribeRegistry: () => void;
  #active: MainViewInstance | null = null;
  #revision = 0;

  constructor(registry: MainViewRegistry) {
    this.#registry = registry;
    this.#unsubscribeRegistry = registry.subscribe(() => {
      if (this.#active && !registry.get(this.#active.kind)) this.close();
    });
  }

  readonly open = <P extends Record<string, unknown>>({
    kind,
    params,
    title,
  }: OpenMainViewRequest<P>): void => {
    if (kind.trim().length === 0) {
      throw new Error("Main view kind must be a non-empty string");
    }
    if (!this.#registry.get(kind)) {
      throw new Error(`Unknown main view "${kind}"`);
    }
    if (typeof title === "string" && title.trim().length === 0) {
      throw new Error("Main view title must be a non-empty string");
    }

    this.#active = Object.freeze({
      kind,
      params: Object.freeze({ ...params }),
      revision: ++this.#revision,
      title,
    });
    this.#emit();
  };

  readonly close = (): void => {
    if (!this.#active) return;
    this.#active = null;
    this.#emit();
  };

  readonly getSnapshot = (): MainViewInstance | null => this.#active;

  readonly getInitialSnapshot = (): null => null;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  dispose(): void {
    this.#unsubscribeRegistry();
    this.#listeners.clear();
    this.#active = null;
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
