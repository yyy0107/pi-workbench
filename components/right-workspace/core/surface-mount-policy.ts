import type { WorkspaceSurfaceCachePolicy } from "./surface-types";

export function shouldMountWorkspaceSurface({
  available,
  cachePolicy,
  hasActivated,
  isActive,
}: Readonly<{
  available: boolean;
  cachePolicy?: WorkspaceSurfaceCachePolicy;
  hasActivated: boolean;
  isActive: boolean;
}>): boolean {
  if (isActive) return true;
  return available && cachePolicy === "keep-alive" && hasActivated;
}
