type ModelCatalogInvalidationListener = () => void;

const listeners = new Set<ModelCatalogInvalidationListener>();
let revision = 0;

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
