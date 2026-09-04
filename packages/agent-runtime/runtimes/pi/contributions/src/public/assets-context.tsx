"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Renderer-owned URLs required by Pi contribution presentation.
 *
 * The package deliberately does not assume a Next public root or a particular static-export
 * layout. Each application assembly supplies its own served Pi assets.
 */
export interface PiContributionAssets {
  readonly fileViewerAssetBaseUrl: string;
}

export interface PiContributionBranding {
  readonly piLogoUrl: string;
  readonly runtimeName: string;
}

const PiContributionAssetsContext = createContext<PiContributionAssets | null>(null);
const PiContributionBrandingContext = createContext<PiContributionBranding | null>(null);

export function normalizePiAssetBaseUrl(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("Pi contribution asset base URL must not be empty.");
  const baseUrl = input.replace(/\/+$/u, "");
  return baseUrl ? `${baseUrl}/` : "/";
}

export function piContributionAssetUrl(assetBaseUrl: string, relativePath: string): string {
  return `${normalizePiAssetBaseUrl(assetBaseUrl)}${relativePath.replace(/^\/+/, "")}`;
}

export function PiContributionAssetsProvider({
  assets,
  children,
}: Readonly<{
  assets: PiContributionAssets;
  children: ReactNode;
}>) {
  const value = useMemo(
    () => ({
      ...assets,
      fileViewerAssetBaseUrl: normalizePiAssetBaseUrl(assets.fileViewerAssetBaseUrl),
    }),
    [assets.fileViewerAssetBaseUrl],
  );

  return (
    <PiContributionAssetsContext.Provider value={value}>
      {children}
    </PiContributionAssetsContext.Provider>
  );
}

export function PiContributionBrandingProvider({
  branding,
  children,
}: Readonly<{
  branding: PiContributionBranding;
  children: ReactNode;
}>) {
  return (
    <PiContributionBrandingContext.Provider value={branding}>
      {children}
    </PiContributionBrandingContext.Provider>
  );
}

export function usePiContributionBranding(): PiContributionBranding {
  const branding = useContext(PiContributionBrandingContext);
  if (!branding) {
    throw new Error(
      "PiAgentRuntimeContributionsProvider is required by Pi contribution components.",
    );
  }
  return branding;
}

export function usePiContributionAssets(): PiContributionAssets {
  const assets = useContext(PiContributionAssetsContext);
  if (!assets) {
    throw new Error(
      "PiAgentRuntimeContributionsProvider is required by Pi contribution components.",
    );
  }
  return assets;
}
