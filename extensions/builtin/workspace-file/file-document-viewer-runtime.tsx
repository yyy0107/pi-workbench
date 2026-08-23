"use client";

import { setDefaultFileViewerAssetBaseUrl } from "@file-viewer/core";
import litePreset from "@file-viewer/preset-lite";
import officePreset from "@file-viewer/preset-office";
import FileViewer from "@file-viewer/react";
import { useMemo } from "react";

import type { Locale } from "@/i18n";

import styles from "./file-document-viewer-runtime.module.css";
import { resolveFileViewerType } from "./file-viewer-source";

setDefaultFileViewerAssetBaseUrl("/file-viewer/");

export interface FileDocumentViewerRuntimeProps {
  url?: string;
  content?: string;
  name: string;
  mediaType: string;
  size: number;
  locale: Locale;
  ariaLabel: string;
}

export function FileDocumentViewerRuntime({
  url,
  content,
  name,
  mediaType,
  size,
  locale,
  ariaLabel,
}: FileDocumentViewerRuntimeProps) {
  const file = useMemo(
    () => (content === undefined ? undefined : new Blob([content], { type: mediaType })),
    [content, mediaType],
  );
  const options = useMemo(
    () => ({
      preset: [litePreset, officePreset],
      rendererMode: "replace" as const,
      styleIsolation: "shadow" as const,
      theme: "system" as const,
      locale,
      fit: { mode: "contain" as const, resize: "until-interaction" as const },
      ui: {
        density: "compact" as const,
        surfaceBackground: "color-mix(in srgb, var(--muted) 35%, transparent)",
      },
      toolbar: {
        position: "bottom-right" as const,
        theme: false,
      },
      pdf: {
        assetBaseUrl: "/file-viewer/",
        streaming: "same-origin" as const,
      },
    }),
    [locale],
  );

  return (
    <FileViewer
      className={styles.viewer}
      {...(file ? { file } : { url })}
      name={name}
      type={resolveFileViewerType(name)}
      size={size}
      options={options}
      aria-label={ariaLabel}
    />
  );
}
