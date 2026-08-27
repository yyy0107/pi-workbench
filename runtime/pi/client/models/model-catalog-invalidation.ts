type ModelCatalogInvalidationListener = () => void;

const listeners = new Set<ModelCatalogInvalidationListener>();
let revision = 0;
const sessionSelectionListeners = new Map<string, Set<ModelCatalogInvalidationListener>>();
const sessionSelectionRevisions = new Map<string, number>();

export function getPiModelCatalogRevision(): number {
  return revision;
}

export function subscribePiModelCatalogInvalidation(
  listener: ModelCatalogInvalidationListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function invalidatePiModelCatalog(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

export function getPiSessionModelSelectionRevision(sessionId: string): number {
  return sessionSelectionRevisions.get(sessionId) ?? 0;
}

export function subscribePiSessionModelSelectionInvalidation(
  sessionId: string,
  listener: ModelCatalogInvalidationListener,
): () => void {
  const sessionListeners = sessionSelectionListeners.get(sessionId) ?? new Set();
  sessionListeners.add(listener);
  sessionSelectionListeners.set(sessionId, sessionListeners);
  return () => {
    sessionListeners.delete(listener);
    if (sessionListeners.size === 0) sessionSelectionListeners.delete(sessionId);
  };
}

export function invalidatePiSessionModelSelection(sessionId: string): void {
  sessionSelectionRevisions.set(sessionId, getPiSessionModelSelectionRevision(sessionId) + 1);
  for (const listener of sessionSelectionListeners.get(sessionId) ?? []) listener();
}
