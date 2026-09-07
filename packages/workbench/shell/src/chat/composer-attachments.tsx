"use client";

import { ChevronRightIcon, FileTextIcon, ScanTextIcon, XIcon } from "lucide-react";
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
        "aui-composer-attachment-image bg-muted relative overflow-hidden rounded-[var(--composer-attachment-radius)] outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-border after:ring-inset",
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
        <div className="animate-in fade-in-0 zoom-in-95 relative shrink-0 duration-200 motion-reduce:animate-none">
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
            variant="default"
            data-frame="none"
            className="aui-composer-attachment-remove absolute end-0.5 top-0.5 rounded-full after:absolute after:-inset-1 motion-reduce:transition-none"
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
    <div className="aui-composer-attachment-text bg-background border-border relative flex items-center gap-3 rounded-[var(--composer-attachment-radius)] border py-1 ps-3 pe-[var(--control-hit-compact)]">
      <ScanTextIcon className="aui-composer-icon-size-attachment text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        {restoreFailed ? (
          <p
            role="alert"
            className="text-destructive truncate text-xs"
            title={t("chatContent.textAttachment.restoreFailed")}
          >
            {t("chatContent.textAttachment.restoreFailed")}
          </p>
        ) : ready ? (
          <PastedTextAttachmentPreview attachment={attachment.attachment} compact />
        ) : (
          <span className="block truncate font-mono text-sm">
            {attachment.text.slice(0, 80) || t("chatContent.textAttachment.title")}
          </span>
        )}
        <div className="flex min-w-0 items-center gap-1">
          <span
            role={attachment.status === "error" ? "alert" : "status"}
            className={cn("text-muted-foreground min-w-0 truncate text-xs", ready && "sr-only")}
            title={t(
              `chatContent.textAttachment.${ready ? "ready" : attachment.status === "saving" ? "saving" : errorKey}`,
            )}
          >
            {t(
              `chatContent.textAttachment.${ready ? "ready" : attachment.status === "saving" ? "saving" : errorKey}`,
            )}
          </span>
          {attachment.status === "error" && (
            <Button
              variant="link"
              size="xs"
              className="h-auto min-h-0 px-0 py-0"
              onClick={() => onRetry(attachment.key)}
            >
              {t("chatContent.textAttachment.retry")}
            </Button>
          )}
          {ready && canRestorePastedText(attachment.attachment.characterCount) && (
            <Button
              variant="link"
              size="xs"
              className="text-muted-foreground h-auto min-h-0 min-w-0 max-w-full justify-start px-0 py-0 underline"
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
              <span className="truncate">
                {t(
                  restoring
                    ? "chatContent.textAttachment.restoring"
                    : "chatContent.textAttachment.restore",
                )}
              </span>
              <ChevronRightIcon />
            </Button>
          )}
        </div>
      </div>
      <TooltipIconButton
        tooltip={t("chatContent.textAttachment.remove")}
        variant="default"
        data-frame="none"
        className="aui-composer-attachment-remove absolute end-1 top-1 rounded-full"
        onClick={() => onRemove(attachment.key)}
        disabled={restoring}
      >
        <XIcon />
      </TooltipIconButton>
    </div>
  );
}
