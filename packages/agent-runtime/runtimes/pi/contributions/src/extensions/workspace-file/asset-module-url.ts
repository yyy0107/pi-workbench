/**
 * Static assets have two supported module shapes across the renderers that consume this package:
 * Vite returns a URL string, while Next's static-image loader returns `{ src }` (with additional
 * optional metadata). Keep that packaging distinction at one narrow boundary.
 */
export type AssetModule = string | Readonly<{ src: string; [metadata: string]: unknown }>;

export function assetModuleUrl(asset: AssetModule): string {
  const url = typeof asset === "string" ? asset : asset.src;
  if (!url.trim()) throw new Error("Static asset modules must expose a non-empty URL.");
  return url;
}
