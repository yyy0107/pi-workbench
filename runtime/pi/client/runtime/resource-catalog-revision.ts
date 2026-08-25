"use client";

type ResourceCatalogListener = () => void;

const listeners = new Set<ResourceCatalogListener>();
let revision = 0;

export function getPiResourceCatalogRevision(): number {
  return revision;
}

export function subscribePiResourceCatalog(listener: ResourceCatalogListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function invalidatePiResourceCatalog(): void {
  revision += 1;
  for (const listener of listeners) listener();
}
