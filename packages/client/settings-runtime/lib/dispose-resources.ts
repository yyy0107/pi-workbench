/** Dispose every cached resource even if one disposer fails, then release the cache. */
export function disposeResources(resources: Map<symbol, unknown>): void {
  for (const resource of resources.values()) {
    if (
      !resource ||
      typeof resource !== "object" ||
      !("dispose" in resource) ||
      typeof resource.dispose !== "function"
    )
      continue;
    try {
      resource.dispose();
    } catch (error) {
      console.error("[workbench] failed to dispose a settings presentation resource", error);
    }
  }
  resources.clear();
}
