"use client";

import { FileTextIcon, XIcon } from "lucide-react";
import { useState } from "react";

import type { ComposerAttachment } from "@workbench/agent-runtime-contracts/conversation";

import { TooltipIconButton } from "../ui/tooltip-icon-button";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "../ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { useI18n } from "../i18n";
import { cn } from "../utils";

function AttachmentPreview({ source }: Readonly<{ source: string }>) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      src={source}
      alt={t("assistant.attachment.previewAlt")}
      className={cn(
        "block h-auto max-h-[80vh] w-auto max-w-full rounded-sm object-contain transition-opacity duration-300 motion-reduce:transition-none",
        loaded ? "opacity-100" : "opacity-0",
      )}
      onLoad={() => setLoaded(true)}
    />
  );
}

function AttachmentTile({
  attachment,
  onRemove,
}: Readonly<{
  attachment: ComposerAttachment;
  onRemove(key: string): void;
}>) {
  const { t } = useI18n();
  const isImage = attachment.mediaType?.startsWith("image/") === true;
  const typeLabel = isImage ? t("assistant.attachment.image") : t("assistant.attachment.document");
  const tile = (
    <div
      className={cn(
        "bg-muted relative size-14 overflow-hidden rounded-[max(0px,calc(var(--composer-radius,1.5rem)-var(--composer-padding,8px)))] outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-black/10 after:ring-inset dark:after:ring-white/10",
        isImage &&
          "hover:after:bg-foreground/10 focus-visible:ring-ring/50 cursor-zoom-in transition-transform after:transition-colors focus-visible:ring-3 active:scale-[0.96] motion-reduce:transition-none",
      )}
      role={isImage ? "button" : "group"}
      tabIndex={isImage ? 0 : undefined}
      aria-label={t("assistant.attachment.accessibleLabel", { type: typeLabel, status: "" })}
    >
      <Avatar className="h-full w-full rounded-none after:hidden">
        <AvatarImage
          src={isImage ? attachment.source : undefined}
          alt={t("assistant.attachment.previewAlt")}
          className="rounded-none object-cover"
        />
        <AvatarFallback>
          <FileTextIcon className="text-muted-foreground/80 aui-composer-icon-size-attachment" />
        </AvatarFallback>
      </Avatar>
    </div>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <div className="animate-in fade-in-0 zoom-in-95 relative duration-200 motion-reduce:animate-none">
          {isImage ? (
            <Dialog>
              <DialogTrigger nativeButton={false} render={<TooltipTrigger render={tile} />} />
              <DialogContent
                closeLabel={t("assistant.common.close")}
                closeButtonFrame="none"
                className="[&>button]:bg-foreground/60 [&>button]:hover:bg-foreground/80 [&_svg]:text-background p-2 sm:max-w-3xl [&>button]:rounded-full [&>button]:p-1 [&>button]:opacity-100 [&>button]:ring-0!"
              >
                <DialogTitle className="sr-only">
                  {t("assistant.attachment.previewTitle")}
                </DialogTitle>
                <div className="bg-background relative mx-auto flex max-h-[80dvh] w-full items-center justify-center overflow-hidden rounded-sm">
                  <AttachmentPreview source={attachment.source} />
                </div>
              </DialogContent>
            </Dialog>
          ) : (
            <TooltipTrigger render={tile} />
          )}
          <TooltipIconButton
            tooltip={t("assistant.composer.removeFile")}
            type="button"
            data-frame="none"
            className="aui-composer-attachment-remove absolute end-0.5 top-0.5 rounded-full bg-black/50! p-1! text-white backdrop-blur-sm after:absolute after:-inset-1 hover:bg-black/70! hover:text-white! active:scale-[0.96] motion-reduce:transition-none"
            side="top"
            onClick={() => onRemove(attachment.key)}
          >
            <XIcon />
          </TooltipIconButton>
        </div>
        <TooltipContent side="top">{attachment.name}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ComposerAttachments({
  attachments,
  onRemove,
}: Readonly<{
  attachments: readonly ComposerAttachment[];
  onRemove(key: string): void;
}>) {
  return (
    <div className="aui-composer-attachments flex w-full flex-row items-center gap-2 overflow-x-auto empty:hidden">
      {attachments.map((attachment) => (
        <AttachmentTile key={attachment.key} attachment={attachment} onRemove={onRemove} />
      ))}
    </div>
  );
}
