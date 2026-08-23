"use client";

import { useEffect, useState } from "react";

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
  const [objectUrl, setObjectUrl] = useState<string>();

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

  return (
    <section className="bg-muted/20 flex size-full min-h-0 items-center justify-center overflow-hidden p-3">
      {source ? (
        <img
          src={source}
          alt={ariaLabel}
          draggable={false}
          decoding="async"
          className="pointer-events-none block max-h-full max-w-full select-none object-contain"
        />
      ) : (
        <span className="text-muted-foreground text-sm">{loadingLabel}</span>
      )}
    </section>
  );
}
