"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { FilePreviewLoading } from "./file-preview-loading";
import { FilePreviewUnavailable } from "./file-preview-unavailable";

export interface FileMediaPreviewProps {
  url: string;
  mediaType: string;
  ariaLabel: string;
  loadingLabel: string;
  errorTitle: string;
  errorDescription: string;
}

export function FileMediaPreview({
  url,
  mediaType,
  ariaLabel,
  loadingLabel,
  errorTitle,
  errorDescription,
}: Readonly<FileMediaPreviewProps>) {
  const [readySource, setReadySource] = useState<string>();
  const [failedSource, setFailedSource] = useState<string>();
  const ready = readySource === url;
  const failed = failedSource === url;
  const loading = !ready && !failed;
  const video = mediaType.toLowerCase().startsWith("video/");
  const mediaClassName = cn(
    "transition-opacity duration-200 motion-reduce:transition-none",
    video ? "block size-full object-contain" : "w-full max-w-xl",
    ready ? "opacity-100" : "opacity-0",
  );
  const settle = () => {
    setFailedSource(undefined);
    setReadySource(url);
  };
  const fail = () => {
    setReadySource(undefined);
    setFailedSource(url);
  };

  return (
    <section
      aria-busy={loading}
      className="bg-muted/20 relative flex size-full min-h-0 items-center justify-center overflow-hidden p-3"
    >
      {video ? (
        <video
          src={url}
          aria-label={ariaLabel}
          controls
          playsInline
          preload="metadata"
          className={mediaClassName}
          onLoadedMetadata={settle}
          onLoadedData={settle}
          onCanPlay={settle}
          onError={fail}
        />
      ) : (
        <audio
          src={url}
          aria-label={ariaLabel}
          controls
          preload="metadata"
          className={mediaClassName}
          onLoadedMetadata={settle}
          onLoadedData={settle}
          onCanPlay={settle}
          onError={fail}
        />
      )}
      {loading ? (
        <FilePreviewLoading className="bg-muted/20 absolute inset-0 z-10" label={loadingLabel} />
      ) : null}
      {failed ? (
        <FilePreviewUnavailable
          className="absolute inset-0 z-10"
          title={errorTitle}
          description={errorDescription}
        />
      ) : null}
    </section>
  );
}
