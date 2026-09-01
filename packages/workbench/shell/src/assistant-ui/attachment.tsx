"use client";

import { type PropsWithChildren, useEffect, useState, type FC, isValidElement } from "react";
import { XIcon, PaperclipIcon, FileText, Loader2Icon, AlertCircleIcon } from "lucide-react";
import { AttachmentPrimitive, ComposerPrimitive, useAuiState, useAui } from "@assistant-ui/react";
import { useShallow } from "zustand/shallow";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { Dialog, DialogTitle, DialogContent, DialogTrigger } from "../ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "../ui/avatar";
import { TooltipIconButton } from "./tooltip-icon-button";
import { useI18n } from "../i18n";
import { cn } from "../utils";

const useFileSrc = (file: File | undefined) => {
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!file) {
      setSrc(undefined);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setSrc(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return src;
};

const useAttachmentSrc = () => {
  const { file, src } = useAuiState(
    useShallow((s): { file?: File; src?: string } => {
      if (s.attachment.type !== "image") return {};
      if (s.attachment.file) return { file: s.attachment.file };
      const src = s.attachment.content?.filter((c) => c.type === "image")[0]?.image;
      if (!src) return {};
      return { src };
    }),
  );

  return useFileSrc(file) ?? src;
};

type AttachmentPreviewProps = {
  src: string;
};

const AttachmentPreview: FC<AttachmentPreviewProps> = ({ src }) => {
  const { t } = useI18n();
  const [isLoaded, setIsLoaded] = useState(false);
  return (
    <img
      src={src}
      alt={t("assistant.attachment.previewAlt")}
      className={cn(
        "block h-auto max-h-[80vh] w-auto max-w-full rounded-sm object-contain transition-opacity duration-300 motion-reduce:transition-none",
        isLoaded
          ? "aui-attachment-preview-image-loaded opacity-100"
          : "aui-attachment-preview-image-loading opacity-0",
      )}
      onLoad={() => setIsLoaded(true)}
    />
  );
};

const AttachmentPreviewDialog: FC<PropsWithChildren> = ({ children }) => {
  const { t } = useI18n();
  const src = useAttachmentSrc();

  if (!src) return children;

  return (
    <Dialog>
      <DialogTrigger
        nativeButton={false}
        className="aui-attachment-preview-trigger cursor-zoom-in"
        render={isValidElement(children) ? children : <button type="button" />}
      />
      <DialogContent
        closeLabel={t("assistant.common.close")}
        closeButtonFrame="none"
        className="aui-attachment-preview-dialog-content [&>button]:bg-foreground/60 [&>button]:hover:bg-foreground/80 [&_svg]:text-background p-2 sm:max-w-3xl [&>button]:rounded-full [&>button]:p-1 [&>button]:opacity-100 [&>button]:ring-0!"
      >
        <DialogTitle className="aui-sr-only sr-only">
          {t("assistant.attachment.previewTitle")}
        </DialogTitle>
        <div className="aui-attachment-preview bg-background relative mx-auto flex max-h-[80dvh] w-full items-center justify-center overflow-hidden rounded-sm">
          <AttachmentPreview src={src} />
        </div>
      </DialogContent>
    </Dialog>
  );
};

const AttachmentThumb: FC = () => {
  const { t } = useI18n();
  const src = useAttachmentSrc();

  return (
    <Avatar className="aui-attachment-tile-avatar h-full w-full rounded-none after:hidden">
      <AvatarImage
        src={src}
        alt={t("assistant.attachment.previewAlt")}
        className="aui-attachment-tile-image rounded-none object-cover"
      />
      <AvatarFallback>
        <FileText className="aui-attachment-tile-fallback-icon text-muted-foreground/80 size-6 stroke-[1.5]" />
      </AvatarFallback>
    </Avatar>
  );
};

const AttachmentUI: FC = () => {
  const { t } = useI18n();
  const aui = useAui();
  const isComposer = aui.attachment.source !== "message";

  const isImage = useAuiState((s) => s.attachment.type === "image");
  const attachmentType = useAuiState((s) => s.attachment.type);
  const typeLabel =
    attachmentType === "image"
      ? t("assistant.attachment.image")
      : attachmentType === "document"
        ? t("assistant.attachment.document")
        : attachmentType === "file"
          ? t("assistant.attachment.file")
          : attachmentType;

  const uploadState = useAuiState((s) =>
    s.attachment.status.type === "running"
      ? "uploading"
      : s.attachment.status.type === "incomplete" && s.attachment.status.reason === "error"
        ? "error"
        : undefined,
  );
  const isUploading = uploadState === "uploading";
  const isError = uploadState === "error";

  const errorMessage = useAuiState((s) =>
    s.attachment.status.type === "incomplete" && s.attachment.status.reason === "error"
      ? s.attachment.status.message
      : undefined,
  );
  const displayedErrorMessage = isError
    ? (errorMessage ?? t("assistant.attachment.uploadFailed"))
    : undefined;
  const statusLabel = isError
    ? t("assistant.attachment.statusFailed")
    : isUploading
      ? t("assistant.attachment.statusUploading")
      : "";

  return (
    <TooltipProvider>
      <Tooltip>
        <AttachmentPrimitive.Root
          className={cn(
            "aui-attachment-root relative",
            isComposer && "animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none",
            isImage && !isComposer && "aui-attachment-root-message only:*:first:size-24",
          )}
        >
          <AttachmentPreviewDialog>
            <TooltipTrigger
              render={
                <div
                  className={cn(
                    "aui-attachment-tile bg-muted relative size-14 overflow-hidden rounded-[max(0px,calc(var(--composer-radius,1.5rem)-var(--composer-padding,8px)))] outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-black/10 after:ring-inset dark:after:ring-white/10",
                    isImage &&
                      "hover:after:bg-foreground/10 focus-visible:ring-ring/50 cursor-pointer transition-transform after:transition-colors focus-visible:ring-3 active:scale-[0.96] motion-reduce:transition-none",
                    isError && "after:ring-destructive/60 dark:after:ring-destructive/60",
                  )}
                  role={isImage ? "button" : "group"}
                  tabIndex={isImage ? 0 : undefined}
                  aria-label={t("assistant.attachment.accessibleLabel", {
                    type: typeLabel,
                    status: statusLabel,
                  })}
                />
              }
            >
              <AttachmentThumb />
              {isUploading && (
                <div
                  aria-hidden="true"
                  className="aui-attachment-tile-uploading bg-background/60 animate-in fade-in-0 absolute inset-0 flex items-center justify-center backdrop-blur-[2px] motion-reduce:animate-none"
                >
                  <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
                </div>
              )}
              {isError && (
                <div
                  aria-hidden="true"
                  className="aui-attachment-tile-error bg-background/70 animate-in fade-in-0 absolute inset-0 flex items-center justify-center backdrop-blur-[2px] motion-reduce:animate-none"
                >
                  <AlertCircleIcon className="text-destructive size-4" />
                </div>
              )}
            </TooltipTrigger>
          </AttachmentPreviewDialog>
          {isComposer && <AttachmentRemove />}
        </AttachmentPrimitive.Root>
        <TooltipContent side="top">
          <AttachmentPrimitive.Name />
          {displayedErrorMessage && (
            <p className="aui-attachment-error-message">{displayedErrorMessage}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const AttachmentRemove: FC = () => {
  const { t } = useI18n();

  return (
    <AttachmentPrimitive.Remove
      render={
        <TooltipIconButton
          tooltip={t("assistant.composer.removeFile")}
          data-frame="none"
          className="aui-attachment-tile-remove absolute end-0.5 top-0.5 size-5! min-h-0! min-w-0! rounded-full bg-black/50! p-1! text-white backdrop-blur-sm after:absolute after:-inset-1 [&_svg]:size-3! hover:bg-black/70! hover:text-white! active:scale-[0.96] motion-reduce:transition-none"
          side="top"
        />
      }
    >
      <XIcon className="aui-attachment-remove-icon size-3 stroke-[2.5]" />
    </AttachmentPrimitive.Remove>
  );
};

export const ComposerAttachments: FC = () => {
  return (
    <div className="aui-composer-attachments flex w-full flex-row items-center gap-2 overflow-x-auto empty:hidden">
      <ComposerPrimitive.Attachments>{() => <AttachmentUI />}</ComposerPrimitive.Attachments>
    </div>
  );
};

export const ComposerAddAttachment: FC = () => {
  const { t } = useI18n();

  return (
    <ComposerPrimitive.AddAttachment
      render={
        <TooltipIconButton
          tooltip={t("assistant.composer.addAttachment")}
          side="bottom"
          variant="ghost"
          size="icon"
          data-frame="none"
          className="aui-composer-add-attachment text-muted-foreground hover:text-foreground hover:bg-muted-foreground/15 dark:border-muted-foreground/15 dark:hover:bg-muted-foreground/30 size-8 rounded-[var(--button-radius)] active:scale-[0.96] motion-reduce:transition-none"
          aria-label={t("assistant.composer.addAttachment")}
        />
      }
    >
      <PaperclipIcon className="aui-attachment-add-icon size-4" />
    </ComposerPrimitive.AddAttachment>
  );
};
