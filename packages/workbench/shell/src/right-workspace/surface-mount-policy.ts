import type { WorkspaceSurfaceCachePolicy } from "@workbench/extension-sdk";

export function shouldMountWorkspaceSurface({
  available,
  cachePolicy,
  dirty,
  hasActivated,
  isVisible,
}: Readonly<{
  available: boolean;
  cachePolicy?: WorkspaceSurfaceCachePolicy;
  dirty: boolean;
  hasActivated: boolean;
  isVisible: boolean;
}>): boolean {
  if (isVisible) return true;
  if (!available) return false;
  if (cachePolicy === "preserve-dirty" && dirty) return true;
  return cachePolicy === "keep-alive" && hasActivated;
}
