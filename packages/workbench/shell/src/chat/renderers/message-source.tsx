"use client";

import { ExternalLinkIcon } from "lucide-react";

export type MessageSourceVariant = "plain" | "chip";

function safeExternalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function MessageSource({
  label,
  url: rawUrl,
  variant,
}: Readonly<{ label: string; url?: string; variant: MessageSourceVariant }>) {
  const url = safeExternalUrl(rawUrl);
  const plain = variant === "plain";
  const className = plain
    ? "inline-flex max-w-full items-center gap-1 text-xs underline"
    : "bg-muted/60 hover:bg-muted my-1 inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs underline-offset-2 hover:underline";

  if (!url) {
    return (
      <span
        className={
          plain
            ? "text-xs"
            : "bg-muted text-muted-foreground my-1 inline-flex rounded-md px-2 py-1 text-xs"
        }
      >
        {label}
      </span>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={className}>
      <span className="truncate">{label}</span>
      <ExternalLinkIcon aria-hidden="true" className="aui-chat-icon-size-default" />
    </a>
  );
}
