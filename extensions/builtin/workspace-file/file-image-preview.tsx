"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { FilePreviewLoading } from "./file-preview-loading";

export interface FileImagePreviewProps {
  url?: string;
  content?: string;
  mediaType: string;
  ariaLabel: string;
  loadingLabel: string;
}

export function FileImagePreview({
  url,
  content,
  mediaType,
  ariaLabel,
  loadingLabel,
}: FileImagePreviewProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [objectUrl, setObjectUrl] = useState<string>();
  const [settledSource, setSettledSource] = useState<string>();

  useEffect(() => {
    if (content === undefined) {
      setObjectUrl(undefined);
      return;
    }

    const nextObjectUrl = URL.createObjectURL(new Blob([content], { type: mediaType }));
    setObjectUrl(nextObjectUrl);
    return () => URL.revokeObjectURL(nextObjectUrl);
  }, [content, mediaType]);

  const source = content === undefined ? url : objectUrl;
  const settled = Boolean(source && settledSource === source);

  useEffect(() => {
    if (source && imageRef.current?.complete) setSettledSource(source);
  }, [source]);

  return (
    <section
      aria-busy={!settled}
      className="bg-muted/20 relative flex size-full min-h-0 items-center justify-center overflow-hidden p-3"
    >
      {source ? (
        <>
          <img
            ref={imageRef}
            src={source}
            alt={ariaLabel}
            draggable={false}
            decoding="async"
            onLoad={() => setSettledSource(source)}
            onError={() => setSettledSource(source)}
            className={cn(
              "pointer-events-none block max-h-full max-w-full select-none object-contain transition-opacity duration-200 motion-reduce:transition-none",
              settled ? "opacity-100" : "opacity-0",
            )}
          />
          {!settled ? (
            <FilePreviewLoading className="absolute inset-0" label={loadingLabel} />
          ) : null}
        </>
      ) : (
        <FilePreviewLoading label={loadingLabel} />
      )}
    </section>
  );
}
