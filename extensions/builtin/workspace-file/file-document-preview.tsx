"use client";

import dynamic from "next/dynamic";

import { useI18n } from "@/i18n";

import { FileImagePreview } from "./file-image-preview";
import { isImagePreviewFile } from "./file-view-mode";

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

  if (isImagePreviewFile(props.name, props.mediaType)) {
    return <FileImagePreview {...props} loadingLabel={loadingLabel} />;
  }

  return (
    <section className="bg-muted/20 relative h-full min-h-0 overflow-hidden">
      <div className="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm">
        {loadingLabel}
      </div>
      <div className="absolute inset-0">
        <FileDocumentViewerRuntime {...props} locale={locale} />
      </div>
    </section>
  );
}
