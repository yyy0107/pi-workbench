"use client";

import litePreset from "@file-viewer/preset-lite";
import officePreset from "@file-viewer/preset-office";
import FileViewer, { type FileViewerHandle, type ViewerState } from "@file-viewer/react";
import { useEffect, useMemo, useRef } from "react";

import type { Locale } from "@workbench/shell/i18n";
import { useWorkbenchAssets } from "@workbench/shell/presentation";

import styles from "./file-document-viewer-runtime.module.css";
import { isFileViewerVideoType, resolveFileViewerType } from "./file-viewer-source";

function fileViewerAssetUrl(baseUrl: string, relativePath: string): string {
  return `${baseUrl}/${relativePath.replace(/^\/+/, "")}`;
}

export interface FileDocumentViewerRuntimeProps {
  url?: string;
  content?: string;
  name: string;
  mediaType: string;
  size: number;
  locale: Locale;
  ariaLabel: string;
  onLoadingChange(loading: boolean): void;
  onLoadError(error: unknown): void;
}

export function FileDocumentViewerRuntime({
  url,
  content,
  name,
  mediaType,
  size,
  locale,
  ariaLabel,
  onLoadingChange,
  onLoadError,
}: FileDocumentViewerRuntimeProps) {
  const { fileViewerAssetBaseUrl } = useWorkbenchAssets();
  const viewerRef = useRef<FileViewerHandle>(null);
  const type = resolveFileViewerType(name);
  const isVideo = isFileViewerVideoType(type);
  const file = useMemo(
    () => (content === undefined ? undefined : new Blob([content], { type: mediaType })),
    [content, mediaType],
  );
  const options = useMemo(
    () => ({
      preset: [litePreset, officePreset],
      rendererMode: "replace" as const,
      styleIsolation: isVideo ? ("scoped" as const) : ("shadow" as const),
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
        assetBaseUrl: `${fileViewerAssetBaseUrl}/`,
        streaming: "same-origin" as const,
      },
      // The File Viewer packages also publish bundler-friendly fallback imports. This desktop
      // build serves one canonical runtime copy from public/file-viewer instead, so make every
      // presentation asset explicit and let packaging discard byte-identical emitted fallbacks.
      presentation: {
        workerUrl: fileViewerAssetUrl(fileViewerAssetBaseUrl, "vendor/pptx/pptx.worker.js"),
        pptModuleUrl: fileViewerAssetUrl(fileViewerAssetBaseUrl, "vendor/ppt/index.mjs"),
        pptWorkerUrl: fileViewerAssetUrl(fileViewerAssetBaseUrl, "vendor/ppt/worker.mjs"),
        pptWasmUrl: fileViewerAssetUrl(fileViewerAssetBaseUrl, "vendor/ppt/ppt-native.wasm"),
        pptFontUrl: fileViewerAssetUrl(fileViewerAssetBaseUrl, "vendor/ppt/ppt-font-cjk.otf"),
      },
    }),
    [fileViewerAssetBaseUrl, isVideo, locale],
  );

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let active = true;
    onLoadingChange(true);
    void viewer
      .load({
        ...(file ? { file } : { url }),
        name,
        type,
        size,
        options,
        onStateChange: (state: ViewerState) => {
          if (!active) return;
          if (state.ready) onLoadingChange(false);
          else if (state.error) onLoadError(state.error);
        },
      })
      .then(
        () => {
          if (active) onLoadingChange(false);
        },
        (error: unknown) => {
          if (active) onLoadError(error);
        },
      );
    return () => {
      active = false;
    };
  }, [file, name, onLoadError, onLoadingChange, options, size, type, url]);

  return (
    <FileViewer
      ref={viewerRef}
      className={isVideo ? `${styles.viewer} ${styles.videoViewer}` : styles.viewer}
      aria-label={ariaLabel}
    />
  );
}
