"use client";

import type { ComponentProps } from "react";
import { PreviewCard } from "@base-ui/react/preview-card";
import { ExternalLinkIcon } from "lucide-react";

import { cn } from "../utils";
import { useWorkbenchPortalContainer } from "../ui/workbench-portal-container";

import { floating, mono } from "../ui/surface";

export interface Source {
  domain: string;
  title: string;
  snippet: string;
  url?: string;
}

interface CitationProps {
  index: number;
  source: Source;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function safeExternalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function Citation({ index, source, open, onOpenChange }: CitationProps) {
  const url = safeExternalUrl(source.url);
  const workbenchContainer = useWorkbenchPortalContainer();

  return (
    <PreviewCard.Root open={open} onOpenChange={onOpenChange}>
      <PreviewCard.Trigger
        delay={0}
        render={<button type="button" />}
        aria-label={source.title}
        className={cn(
          "mx-0.5 inline-flex h-4 min-w-4 translate-y-[-2px] cursor-default items-center justify-center rounded-[5px] px-1 align-middle font-mono text-[10px] font-medium tabular-nums transition-colors",
          open
            ? "bg-foreground text-background"
            : "bg-foreground/[0.06] text-foreground/45 hover:text-foreground/90",
        )}
      >
        {index + 1}
      </PreviewCard.Trigger>
      <PreviewCard.Portal container={workbenchContainer}>
        <PreviewCard.Positioner side="top" sideOffset={8}>
          <PreviewCard.Popup
            className={cn(
              floating,
              "z-50 w-64 origin-(--transform-origin) rounded-2xl p-3.5 outline-none",
              "transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
              "data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0",
              "data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0",
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className="bg-foreground/[0.06] text-foreground/45 flex size-4 items-center justify-center rounded text-[9px] font-medium">
                {source.domain[0]?.toUpperCase()}
              </span>
              <span className={cn(mono, "text-foreground/40")}>{source.domain}</span>
            </div>
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 flex items-start gap-1 text-[13px] leading-snug font-medium underline-offset-2 hover:underline"
              >
                <span>{source.title}</span>
                <ExternalLinkIcon
                  aria-hidden="true"
                  className="mt-0.5 size-3 shrink-0 opacity-50"
                />
              </a>
            ) : (
              <p className="mt-2 text-[13px] leading-snug font-medium">{source.title}</p>
            )}
            <p className="text-foreground/50 mt-1 break-words text-[13px] leading-relaxed">
              {source.snippet}
            </p>
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}

export interface InlineCitationProps extends Omit<ComponentProps<"span">, "children"> {
  sources: Source[];
  openIndex: number | null;
  onOpenIndexChange: (index: number | null) => void;
  /** Adds an offset to the displayed reference number without changing local open-state indices. */
  indexOffset?: number;
}

export function InlineCitation({
  sources,
  openIndex,
  onOpenIndexChange,
  indexOffset = 0,
  className,
  ...props
}: InlineCitationProps) {
  return (
    <span data-slot="inline-citation" className={cn("inline", className)} {...props}>
      {sources.map((source, index) => (
        <Citation
          key={`${source.domain}-${source.title}-${index}`}
          index={index + indexOffset}
          source={source}
          open={openIndex === index}
          onOpenChange={(open) => onOpenIndexChange(open ? index : null)}
        />
      ))}
    </span>
  );
}
