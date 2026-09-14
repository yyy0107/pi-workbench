"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { useI18n } from "@workbench/i18n";
import { Button, TooltipIconButton } from "@workbench/ui";

import { conversationTranslationBundle } from "./i18n";

export interface UserAttachmentGalleryItem {
  readonly key: string;
  readonly kind: "image" | "file";
  readonly content: ReactNode;
}

export function UserAttachmentGallery({
  items,
}: Readonly<{ items: readonly UserAttachmentGalleryItem[] }>) {
  const { t } = useI18n(conversationTranslationBundle);
  const contentId = useId();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) return null;
  if (items.length === 1) return items[0]?.content ?? null;

  const activeIndex = Math.min(currentIndex, items.length - 1);

  return (
    <div
      data-slot="user-attachment-gallery"
      data-expanded={expanded || undefined}
      role="group"
      aria-label={t("chatContent.userAttachmentGallery.label", { count: items.length })}
      className="max-w-full"
    >
      <div id={contentId} data-slot="user-attachment-gallery-items" className="grid min-w-0">
        {items.map((item, index) => (
          <div
            key={item.key}
            data-slot="user-attachment-gallery-item"
            data-kind={item.kind}
            className="bg-muted/30 flex min-w-0 items-center justify-center overflow-hidden rounded-lg"
            hidden={!expanded && index !== activeIndex}
          >
            {item.content}
          </div>
        ))}
      </div>

      <div
        data-slot="user-attachment-gallery-controls"
        className="flex min-w-0 items-center gap-0.5 pt-1"
      >
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? t("chatContent.userAttachmentGallery.collapse")
            : t("chatContent.userAttachmentGallery.showAll", { count: items.length })}
        </Button>

        {!expanded ? (
          <div className="ms-auto flex items-center gap-0.5">
            <TooltipIconButton
              type="button"
              size="icon-sm"
              tooltip={t("chatContent.userAttachmentGallery.previous")}
              disabled={activeIndex === 0}
              onClick={() => setCurrentIndex(Math.max(0, activeIndex - 1))}
            >
              <ChevronLeftIcon aria-hidden="true" className="rtl:rotate-180" />
            </TooltipIconButton>
            <span
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="text-muted-foreground min-w-[calc(var(--control-hit-compact)*2)] text-center text-xs font-medium tabular-nums"
            >
              {t("chatContent.userAttachmentGallery.position", {
                current: activeIndex + 1,
                total: items.length,
              })}
            </span>
            <TooltipIconButton
              type="button"
              size="icon-sm"
              tooltip={t("chatContent.userAttachmentGallery.next")}
              disabled={activeIndex === items.length - 1}
              onClick={() => setCurrentIndex(Math.min(items.length - 1, activeIndex + 1))}
            >
              <ChevronRightIcon aria-hidden="true" className="rtl:rotate-180" />
            </TooltipIconButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}
