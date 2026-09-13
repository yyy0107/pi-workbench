"use client";

import type { ComposerAttachment } from "@workbench/agent-runtime-contracts/conversation";
import { useI18n } from "@workbench/i18n";
import { cn } from "@workbench/ui/utils";
import { FileTypeIcon } from "@workbench/ui-file-presentation/icons";
import { useState } from "react";

import { composerTranslationBundle } from "./i18n";

function AttachmentSummaryVisual({ attachment }: Readonly<{ attachment: ComposerAttachment }>) {
  const source = attachment.kind === "pasted-text" ? undefined : attachment.source;
  const sourceMediaType = source ? /^data:([^;,]+)/u.exec(source)?.[1] : undefined;
  const isImage =
    attachment.mediaType?.startsWith("image/") === true ||
    sourceMediaType?.startsWith("image/") === true;
  const [failedPreviewSource, setFailedPreviewSource] = useState<string>();

  if (isImage && source && source !== failedPreviewSource) {
    return (
      <img
        src={source}
        alt=""
        decoding="async"
        draggable={false}
        className="size-full object-cover"
        onError={() => setFailedPreviewSource(source)}
      />
    );
  }

  return <FileTypeIcon path={attachment.name} className="size-[var(--icon-size-xs)]" />;
}

export function ComposerAttachmentSummary({
  attachments,
  className,
}: Readonly<{
  attachments: readonly ComposerAttachment[];
  className?: string;
}>) {
  const { t } = useI18n(composerTranslationBundle);

  if (attachments.length === 0) return null;

  return (
    <ul
      aria-label={t("assistant.attachment.listLabel")}
      className={cn("flex min-w-0 max-w-full items-center gap-1 overflow-x-auto", className)}
    >
      {attachments.map((attachment) => (
        <li
          key={attachment.key}
          aria-label={attachment.name}
          title={attachment.name}
          className="bg-muted flex size-[var(--icon-frame-size-xs)] shrink-0 items-center justify-center overflow-hidden rounded-[var(--icon-frame-radius-xs)]"
        >
          <AttachmentSummaryVisual attachment={attachment} />
        </li>
      ))}
    </ul>
  );
}
