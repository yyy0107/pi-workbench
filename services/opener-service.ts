import type {
  OpenHandlerContext,
  OpenHandlerDefinition,
  OpenerRegistry,
  OpenerService,
  OpenResourceRequest,
  WorkspaceSurfaceOpenOperations,
} from "@/platform/extensions/api/opener";

export class DefaultOpenerService implements OpenerService {
  readonly #registry: OpenerRegistry;
  readonly #context: OpenHandlerContext;

  constructor(registry: OpenerRegistry, surfaces: WorkspaceSurfaceOpenOperations) {
    this.#registry = registry;
    this.#context = Object.freeze({ surfaces });
  }

  readonly open = async (request: OpenResourceRequest): Promise<string | void> => {
    const handler = this.#selectHandler(request);
    if (!handler) {
      throw new Error(
        `No opener is registered for "${request.resource.scheme}:${request.resource.path}"`,
      );
    }
    return handler.open(request, this.#context);
  };

  readonly getHandlers = (): readonly OpenHandlerDefinition[] => this.#registry.getAll();

  readonly subscribe = (listener: () => void): (() => void) => this.#registry.subscribe(listener);

  #selectHandler(request: OpenResourceRequest): OpenHandlerDefinition | undefined {
    let selected: OpenHandlerDefinition | undefined;
    let selectedScore = 0;

    for (const handler of this.#registry.getAll()) {
      const score = handler.canOpen(request);
      if (!Number.isFinite(score) || score <= selectedScore) continue;
      selected = handler;
      selectedScore = score;
    }

    return selected;
  }
}
