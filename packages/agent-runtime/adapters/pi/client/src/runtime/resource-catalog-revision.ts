"use client";

type ResourceCatalogListener = () => void;

/** One installation's resource-catalog revision signal. */
export class PiResourceCatalogRevision {
  private readonly listeners = new Set<ResourceCatalogListener>();
  private revision = 0;

  getRevision = (): number => this.revision;

  subscribe = (listener: ResourceCatalogListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  invalidate = (): void => {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  };
}
