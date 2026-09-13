"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

export interface FilePresentationAssets {
  readonly materialIconThemeBaseUrl: string;
}

const FilePresentationAssetsContext = createContext<FilePresentationAssets | null>(null);

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!normalized) throw new Error("Material icon theme asset base URL must not be empty");
  return normalized;
}

export function FilePresentationProvider({
  materialIconThemeBaseUrl,
  children,
}: FilePresentationAssets & { children: ReactNode }) {
  const value = useMemo(
    () => ({ materialIconThemeBaseUrl: normalizeBaseUrl(materialIconThemeBaseUrl) }),
    [materialIconThemeBaseUrl],
  );
  return (
    <FilePresentationAssetsContext.Provider value={value}>
      {children}
    </FilePresentationAssetsContext.Provider>
  );
}

export function useFilePresentationAssets(): FilePresentationAssets {
  const value = useContext(FilePresentationAssetsContext);
  if (!value)
    throw new Error("FilePresentationProvider must be installed before rendering file icons");
  return value;
}
