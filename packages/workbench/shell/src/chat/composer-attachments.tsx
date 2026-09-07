"use client";

import { FileTextIcon, XIcon } from "lucide-react";
import { useState } from "react";

import type {
  ComposerAttachment,
  InlineComposerAttachment,
  PastedTextComposerAttachment,
} from "@workbench/agent-runtime-contracts/conversation";

import { canRestorePastedText } from "@workbench/agent-runtime-contracts/composer-attachments";
import { Button } from "../ui/button";
import { PastedTextAttachmentPreview } from "./pasted-text-attachment-preview";

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
  attachment: InlineComposerAttachment;
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
          "hover:after:bg-foreground/10 focus-visible:ring-ring/50 cursor-zoom-in after:transition-colors focus-visible:ring-3 motion-reduce:transition-none",
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
            className="aui-composer-attachment-remove absolute end-0.5 top-0.5 rounded-full bg-black/50! p-1! text-white backdrop-blur-sm after:absolute after:-inset-1 hover:bg-black/70! hover:text-white! motion-reduce:transition-none"
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
  onRetry,
  onRestore,
}: Readonly<{
  attachments: readonly ComposerAttachment[];
  onRemove(key: string): void;
  onRetry(key: string): void;
  onRestore(key: string): Promise<void>;
}>) {
  return (
    <div className="aui-composer-attachments flex w-full flex-row items-center gap-2 overflow-x-auto empty:hidden">
      {attachments.map((attachment) =>
        attachment.kind === "pasted-text" ? (
          <PastedTextTile
            key={attachment.key}
            attachment={attachment}
            onRemove={onRemove}
            onRetry={onRetry}
            onRestore={onRestore}
          />
        ) : (
          <AttachmentTile key={attachment.key} attachment={attachment} onRemove={onRemove} />
        ),
      )}
    </div>
  );
}

function PastedTextTile({
  attachment,
  onRemove,
  onRetry,
  onRestore,
}: {
  attachment: PastedTextComposerAttachment;
  onRemove(key: string): void;
  onRetry(key: string): void;
  onRestore(key: string): Promise<void>;
}) {
  const { t } = useI18n();
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const ready = attachment.status === "ready";
  const errorKey =
    attachment.status === "error" && attachment.error === "attachment-too-large"
      ? "tooLarge"
      : attachment.status === "error" && attachment.error === "too-many-attachments"
        ? "tooMany"
        : "failed";
  return (
    <div className="bg-muted border-border flex max-w-full shrink-0 flex-col gap-1 rounded-[var(--radius-md)] border p-2">
      <div className="flex min-w-0 items-center gap-2">
        {ready ? (
          <PastedTextAttachmentPreview attachment={attachment.attachment} />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <FileTextIcon className="aui-composer-icon-size-attachment text-muted-foreground" />
            <span className="min-w-0">
              <span className="block max-w-xs truncate">
                {attachment.text.slice(0, 80) || t("chatContent.textAttachment.title")}
              </span>
              <span className="text-muted-foreground block text-xs">
                {t("chatContent.textAttachment.characters", { count: attachment.text.length })}
              </span>
            </span>
          </div>
        )}
        <TooltipIconButton
          tooltip={t("chatContent.textAttachment.remove")}
          onClick={() => onRemove(attachment.key)}
          disabled={restoring}
        >
          <XIcon />
        </TooltipIconButton>
      </div>
      <div className="flex items-center gap-2">
        <span
          role={attachment.status === "error" ? "alert" : "status"}
          className="text-muted-foreground text-xs"
        >
          {t(
            `chatContent.textAttachment.${ready ? "ready" : attachment.status === "saving" ? "saving" : errorKey}`,
          )}
        </span>
        {attachment.status === "error" && (
          <Button variant="ghost" size="sm" onClick={() => onRetry(attachment.key)}>
            {t("chatContent.textAttachment.retry")}
          </Button>
        )}
        {ready && canRestorePastedText(attachment.attachment.characterCount) && (
          <Button
            variant="ghost"
            size="sm"
            disabled={restoring}
            onClick={async () => {
              setRestoring(true);
              setRestoreFailed(false);
              try {
                await onRestore(attachment.key);
              } catch {
                setRestoreFailed(true);
              } finally {
                setRestoring(false);
              }
            }}
          >
            {t(
              restoring
                ? "chatContent.textAttachment.restoring"
                : "chatContent.textAttachment.restore",
            )}
          </Button>
        )}
      </div>
      {restoreFailed && (
        <p role="alert" className="text-destructive text-xs">
          {t("chatContent.textAttachment.restoreFailed")}
        </p>
      )}
    </div>
  );
}
