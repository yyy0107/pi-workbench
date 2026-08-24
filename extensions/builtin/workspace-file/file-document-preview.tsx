"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/i18n";
import { WORKSPACE_FILE_BUFFERED_PREVIEW_SIZE_LIMIT } from "@/runtime/pi/rpc-contracts";

import { FileImagePreview } from "./file-image-preview";
import { FileMediaPreview } from "./file-media-preview";
import { FilePreviewLoading } from "./file-preview-loading";
import { FilePreviewUnavailable } from "./file-preview-unavailable";
import { isImagePreviewFile } from "./file-view-mode";
import { isNativeMediaPreviewType } from "./file-viewer-source";

const FileDocumentViewerRuntime = dynamic(
  () => import("./file-document-viewer-runtime").then((module) => module.FileDocumentViewerRuntime),
  {
    ssr: false,
    loading: () => null,
  },
);

export interface FileDocumentPreviewProps {
  url?: string;
  content?: string;
  name: string;
  mediaType: string;
  size: number;
  ariaLabel: string;
}

export function FileDocumentPreview(props: FileDocumentPreviewProps) {
  const { locale, t } = useI18n();
  const loadingLabel = t("extensions.workspaceFile.loadingPreview");
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState(false);
  const handleLoadingChange = useCallback((loading: boolean) => {
    setPreviewLoading(loading);
    if (loading) setPreviewError(false);
  }, []);
  const handleLoadError = useCallback(() => {
    setPreviewLoading(false);
    setPreviewError(true);
  }, []);

  useEffect(() => {
    setPreviewLoading(true);
    setPreviewError(false);
  }, [props.content, props.mediaType, props.name, props.size, props.url]);

  if (props.url && isNativeMediaPreviewType(props.mediaType)) {
    return (
      <FileMediaPreview
        url={props.url}
        mediaType={props.mediaType}
        ariaLabel={props.ariaLabel}
        loadingLabel={loadingLabel}
        errorTitle={t("extensions.workspaceFile.previewUnsupportedTitle")}
        errorDescription={t("extensions.workspaceFile.mediaPreviewLoadFailed", {
          name: props.name,
        })}
      />
    );
  }

  if (props.size > WORKSPACE_FILE_BUFFERED_PREVIEW_SIZE_LIMIT) {
    return (
      <FilePreviewUnavailable
        title={t("extensions.workspaceFile.previewUnsupportedTitle")}
        description={t("extensions.workspaceFile.previewTooLargeDescription", {
          name: props.name,
        })}
      />
    );
  }

  if (isImagePreviewFile(props.name, props.mediaType)) {
    return <FileImagePreview {...props} loadingLabel={loadingLabel} />;
  }

  return (
    <section
      aria-busy={previewLoading}
      className="bg-muted/20 relative h-full min-h-0 overflow-hidden"
    >
      {previewError ? (
        <FilePreviewUnavailable
          className="absolute inset-0 z-10"
          title={t("extensions.workspaceFile.previewUnsupportedTitle")}
          description={t("extensions.workspaceFile.previewLoadFailed", { name: props.name })}
        />
      ) : previewLoading ? (
        <FilePreviewLoading className="bg-muted/20 absolute inset-0 z-10" label={loadingLabel} />
      ) : null}
      <div className="absolute inset-0">
        <FileDocumentViewerRuntime
          {...props}
          locale={locale}
          onLoadingChange={handleLoadingChange}
          onLoadError={handleLoadError}
        />
      </div>
    </section>
  );
}
