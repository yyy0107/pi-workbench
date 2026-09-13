"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

export interface WorkbenchBranding {
  readonly productName: string;
  readonly runtimeName: string;
  readonly productLogoUrl?: string;
}

export interface WorkbenchAssets {
  /** Base URL containing File Viewer workers, WebAssembly, and presentation assets. */
  readonly fileViewerAssetBaseUrl: string;
  /** Base URL containing `material-icons.json` and the `icons/` directory. */
  readonly materialIconThemeBaseUrl: string;
}

interface WorkbenchPresentation {
  readonly assets: WorkbenchAssets;
  readonly branding: WorkbenchBranding;
}

const WorkbenchPresentationContext = createContext<WorkbenchPresentation | null>(null);

function normalizedAssetBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!normalized) throw new Error("Workbench asset base URL must not be empty");
  return normalized;
}

export function WorkbenchPresentationProvider({
  assets,
  branding,
  children,
}: Readonly<WorkbenchPresentation & { children: ReactNode }>) {
  if (!branding.productName.trim()) throw new Error("Workbench product name must not be empty");
  if (!branding.runtimeName.trim()) throw new Error("Workbench runtime name must not be empty");

  const fileViewerAssetBaseUrl = normalizedAssetBaseUrl(assets.fileViewerAssetBaseUrl);
  const materialIconThemeBaseUrl = normalizedAssetBaseUrl(assets.materialIconThemeBaseUrl);
  const value = useMemo<WorkbenchPresentation>(
    () => ({
      assets: { fileViewerAssetBaseUrl, materialIconThemeBaseUrl },
      branding: {
        productLogoUrl: branding.productLogoUrl,
        productName: branding.productName,
        runtimeName: branding.runtimeName,
      },
    }),
    [
      branding.productLogoUrl,
      branding.productName,
      branding.runtimeName,
      fileViewerAssetBaseUrl,
      materialIconThemeBaseUrl,
    ],
  );

  return (
    <WorkbenchPresentationContext.Provider value={value}>
      {children}
    </WorkbenchPresentationContext.Provider>
  );
}

function useWorkbenchPresentation(): WorkbenchPresentation {
  const presentation = useContext(WorkbenchPresentationContext);
  if (!presentation) {
    throw new Error(
      "Workbench presentation must be installed by WorkbenchShell or WorkbenchPresentationProvider",
    );
  }
  return presentation;
}

export function useWorkbenchAssets(): WorkbenchAssets {
  return useWorkbenchPresentation().assets;
}

export function useWorkbenchBranding(): WorkbenchBranding {
  return useWorkbenchPresentation().branding;
}
