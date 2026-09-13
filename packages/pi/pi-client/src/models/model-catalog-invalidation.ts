type ModelCatalogInvalidationListener = () => void;

/** One installation's model-catalog and session-selection revision signals. */
export class PiModelCatalogInvalidation {
  private readonly listeners = new Set<ModelCatalogInvalidationListener>();
  private revision = 0;
  private readonly sessionSelectionListeners = new Map<
    string,
    Set<ModelCatalogInvalidationListener>
  >();
  private readonly sessionSelectionRevisions = new Map<string, number>();

  getRevision = (): number => this.revision;

  subscribe = (listener: ModelCatalogInvalidationListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  invalidate = (): void => {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  };

  getSessionSelectionRevision = (sessionId: string): number =>
    this.sessionSelectionRevisions.get(sessionId) ?? 0;

  subscribeSessionSelection = (
    sessionId: string,
    listener: ModelCatalogInvalidationListener,
  ): (() => void) => {
    const sessionListeners = this.sessionSelectionListeners.get(sessionId) ?? new Set();
    sessionListeners.add(listener);
    this.sessionSelectionListeners.set(sessionId, sessionListeners);
    return () => {
      sessionListeners.delete(listener);
      if (sessionListeners.size === 0) this.sessionSelectionListeners.delete(sessionId);
    };
  };

  invalidateSessionSelection = (sessionId: string): void => {
    this.sessionSelectionRevisions.set(sessionId, this.getSessionSelectionRevision(sessionId) + 1);
    for (const listener of this.sessionSelectionListeners.get(sessionId) ?? []) listener();
  };
}
