import type {
  MainViewBreadcrumbs,
  MainViewInstance,
  MainViewRegistry,
  OpenMainViewRequest,
} from "@workbench/extension-sdk";

function freezeBreadcrumbs<P extends Record<string, unknown>>(
  breadcrumbs: MainViewBreadcrumbs<P>,
): MainViewBreadcrumbs<P> {
  return Object.freeze(
    breadcrumbs.map((item) =>
      Object.freeze({
        label: item.label,
        ...(item.params !== undefined ? { params: Object.freeze({ ...item.params }) as P } : {}),
        ...(item.closeView === true ? { closeView: true as const } : {}),
      }),
    ),
  ) as unknown as MainViewBreadcrumbs<P>;
}

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
    breadcrumbs,
  }: OpenMainViewRequest<P>): void => {
    if (kind.trim().length === 0) {
      throw new Error("Main view kind must be a non-empty string");
    }
    const definition = this.#registry.get(kind);
    if (!definition) {
      throw new Error(`Unknown main view "${kind}"`);
    }
    if (typeof title === "string" && title.trim().length === 0) {
      throw new Error("Main view title must be a non-empty string");
    }
    if (breadcrumbs && breadcrumbs.length === 0) {
      throw new Error("Main view breadcrumbs must contain at least one label");
    }
    if (breadcrumbs?.some(({ label }) => typeof label === "string" && label.trim().length === 0)) {
      throw new Error("Main view breadcrumb labels must be non-empty strings");
    }
    if (breadcrumbs?.some((item) => item.params !== undefined && item.closeView === true)) {
      throw new Error("Main view breadcrumbs cannot define both params and closeView");
    }
    if (
      breadcrumbs?.slice(0, -1).some((item) => item.params === undefined && item.closeView !== true)
    ) {
      throw new Error("Main view ancestor breadcrumbs must define a navigation destination");
    }
    const currentBreadcrumb = breadcrumbs?.at(-1);
    if (currentBreadcrumb?.params !== undefined || currentBreadcrumb?.closeView === true) {
      throw new Error("Main view current breadcrumb cannot define a navigation destination");
    }

    this.#active = Object.freeze({
      kind,
      params: Object.freeze({ ...params }),
      ...(definition.chrome ? { chrome: Object.freeze({ ...definition.chrome }) } : {}),
      ...(breadcrumbs ? { breadcrumbs: freezeBreadcrumbs(breadcrumbs) } : {}),
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

  readonly openBreadcrumb = (index: number): void => {
    const active = this.#active;
    const breadcrumbs = active?.breadcrumbs;
    if (
      !active ||
      !breadcrumbs ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= breadcrumbs.length - 1
    ) {
      return;
    }
    const destination = breadcrumbs[index];
    if (destination.closeView === true) {
      this.close();
      return;
    }
    if (destination.params === undefined) return;

    const destinationBreadcrumbs = breadcrumbs
      .slice(0, index + 1)
      .map((item, itemIndex) =>
        itemIndex === index ? { label: item.label } : item,
      ) as unknown as MainViewBreadcrumbs;
    this.open({
      kind: active.kind,
      title: destination.label,
      breadcrumbs: destinationBreadcrumbs,
      params: destination.params,
    });
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
