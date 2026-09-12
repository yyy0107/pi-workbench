"use client";

import {
  memo,
  useState,
  useEffect,
  useRef,
  type FC,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { cva, type VariantProps } from "class-variance-authority";
import {
  CheckIcon,
  CircleXIcon,
  CopyIcon,
  DownloadIcon,
  ImageIcon,
  ImageOffIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
} from "lucide-react";
import { Button } from "../../ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "../../ui/dialog";
import { useCopyFeedback } from "../../hooks/use-clipboard-copy";
import { useI18n } from "../../i18n";
import { cn } from "../../utils";
import { downloadBlob } from "../../file-download";

interface ImageMessagePart {
  readonly image: string;
  readonly filename?: string;
  readonly prompt?: string;
  readonly status?:
    | { readonly type: "running" }
    | { readonly type: "complete" }
    | {
        readonly type: "incomplete";
        readonly reason: "cancelled" | "length" | "content-filter" | "other" | "error";
      };
}

const extensionForMimeType = (mimeType?: string): string => {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    default:
      return "png";
  }
};

const dataUriToBlob = (dataUri: string): Blob => {
  const [meta, data] = dataUri.split(",");
  const mime = meta?.match(/data:([^;]+)/i)?.[1]?.toLowerCase() ?? "application/octet-stream";
  if (!/;base64/i.test(meta ?? "")) {
    return new Blob([decodeURIComponent(data ?? "")], { type: mime });
  }
  const bytes = atob(data ?? "");
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
};

const mimeFromImage = (image: string): string | undefined =>
  image.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase();

const downloadImagePart = (part: Pick<ImageMessagePart, "image" | "filename">): void => {
  if (typeof document === "undefined") return;
  const ext = extensionForMimeType(mimeFromImage(part.image));
  const filename = part.filename ?? `image.${ext}`;
  if (/^data:/i.test(part.image)) {
    downloadBlob(dataUriToBlob(part.image), filename);
    return;
  }
  const a = document.createElement("a");
  a.href = part.image;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

const imageBlob = (image: string): Promise<Blob> => {
  if (/^data:/i.test(image)) return Promise.resolve(dataUriToBlob(image));

  return fetch(image).then((response) => {
    if (!response.ok) throw new Error(`Could not load image: ${response.status}`);
    return response.blob();
  });
};

const imageBlobAsPng = async (blob: Blob): Promise<Blob> => {
  if (blob.type === "image/png") return blob;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    throw new Error("PNG conversion is not available in this environment.");
  }

  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create an image conversion context.");
    context.drawImage(bitmap, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (png) => (png ? resolve(png) : reject(new Error("Could not convert image to PNG."))),
        "image/png",
      );
    });
  } finally {
    bitmap.close();
  }
};

const copyImagePart = (part: Pick<ImageMessagePart, "image">): Promise<void> => {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof navigator.clipboard.write !== "function" ||
    typeof ClipboardItem === "undefined"
  ) {
    return Promise.reject(new Error("Clipboard API is not available in this environment."));
  }

  const png = imageBlob(part.image).then(imageBlobAsPng);
  return navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
};

const imageVariants = cva("aui-image-root relative overflow-hidden rounded-lg", {
  variants: {
    variant: {
      outline: "border-border border",
      ghost: "",
      muted: "bg-muted/50",
    },
    size: {
      sm: "max-w-64",
      default: "max-w-96",
      lg: "max-w-[512px]",
      full: "w-full",
    },
  },
  defaultVariants: {
    variant: "outline",
    size: "default",
  },
});

export type ImageRootProps = React.ComponentProps<"div"> & VariantProps<typeof imageVariants>;

function ImageRoot({ className, variant, size, children, ...props }: ImageRootProps) {
  return (
    <div
      data-slot="image-root"
      data-variant={variant}
      data-size={size}
      className={cn(imageVariants({ variant, size, className }))}
      {...props}
    >
      {children}
    </div>
  );
}

type ImagePreviewProps = Omit<React.ComponentProps<"img">, "children"> & {
  containerClassName?: string;
  loadingPlaceholder?: ReactNode;
};

function ImagePreview({
  className,
  containerClassName,
  loadingPlaceholder,
  onLoad,
  onError,
  alt,
  src,
  ...props
}: ImagePreviewProps) {
  const { t } = useI18n();
  const imgRef = useRef<HTMLImageElement>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>(undefined);
  const [errorSrc, setErrorSrc] = useState<string | undefined>(undefined);

  const loaded = loadedSrc === src;
  const error = errorSrc === src;

  useEffect(() => {
    if (typeof src === "string" && imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoadedSrc(src);
    }
  }, [src]);

  return (
    <div
      data-slot="image-preview"
      className={cn("relative", !loaded && !error && "min-h-32", containerClassName)}
    >
      {!loaded &&
        !error &&
        (loadingPlaceholder ?? (
          <div
            data-slot="image-preview-loading"
            className="bg-muted/50 absolute inset-0 flex items-center justify-center"
          >
            <ImageIcon className="text-muted-foreground aui-chat-icon-size-placeholder animate-pulse motion-reduce:animate-none" />
          </div>
        ))}
      {error ? (
        <div
          data-slot="image-preview-error"
          role="img"
          aria-label={t("assistant.image.loadFailed")}
          className="bg-muted/50 flex min-h-32 items-center justify-center p-4"
        >
          <ImageOffIcon className="text-muted-foreground aui-chat-icon-size-placeholder" />
        </div>
      ) : (
        <img
          ref={imgRef}
          src={src}
          alt={alt ?? t("assistant.image.contentAlt")}
          className={cn("block h-auto w-full object-contain", !loaded && "invisible", className)}
          onLoad={(e) => {
            if (typeof src === "string") setLoadedSrc(src);
            onLoad?.(e);
          }}
          onError={(e) => {
            if (typeof src === "string") setErrorSrc(src);
            onError?.(e);
          }}
          {...props}
        />
      )}
    </div>
  );
}

function ImageFilename({ className, children, ...props }: React.ComponentProps<"span">) {
  if (!children) return null;

  return (
    <span
      data-slot="image-filename"
      className={cn("text-muted-foreground block truncate px-2 py-1.5 text-xs", className)}
      {...props}
    >
      {children}
    </span>
  );
}

type ImageZoomProps = PropsWithChildren<{
  src: string;
  alt?: string;
  className?: string;
}>;

function ImageZoom({ src, alt, children, className }: ImageZoomProps) {
  const { t } = useI18n();

  return (
    <Dialog>
      <DialogTrigger
        type="button"
        aria-label={t("assistant.image.zoom")}
        className={cn(
          "aui-image-zoom-trigger block w-full cursor-zoom-in border-0 bg-transparent p-0 text-start",
          className,
        )}
      >
        {children}
      </DialogTrigger>
      <DialogContent
        closeLabel={t("assistant.image.closeZoom")}
        closeButtonFrame="none"
        closeButtonInteraction="static"
        closeButtonClassName="top-0 end-0 bg-black/65 text-white"
        overlayClassName="bg-black/80 supports-backdrop-filter:backdrop-blur-sm"
        className="aui-image-zoom-dialog h-fit w-fit max-w-[calc(100vw-2rem)] gap-0 rounded-none bg-transparent p-0 pt-[calc(var(--icon-frame-size-sm)+0.5rem)] shadow-none ring-0 sm:max-w-[calc(100vw-2rem)]"
      >
        <DialogTitle className="sr-only">{t("assistant.image.zoom")}</DialogTitle>
        <img
          data-slot="image-zoom-content"
          src={src}
          alt={alt ?? t("assistant.image.contentAlt")}
          className="aui-image-zoom-content max-h-[90dvh] max-w-[90vw] rounded-lg object-contain"
        />
      </DialogContent>
    </Dialog>
  );
}

function ImageGenerating({ className }: { className?: string }) {
  const { t } = useI18n();

  return (
    <div
      data-slot="image-generating"
      role="status"
      className={cn(
        "relative aspect-square w-full overflow-hidden bg-muted text-muted-foreground",
        className,
      )}
    >
      <span data-slot="image-generating-dots" aria-hidden="true" />
      <span className="sr-only">{t("assistant.image.generating")}</span>
    </div>
  );
}

function ImageContentFilterError({
  className,
  reason,
  stopped = false,
}: {
  className?: string;
  reason?: string;
  stopped?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div
      data-slot="image-content-filter-error"
      role="status"
      className={cn(
        "bg-muted/50 flex min-h-32 flex-col items-center justify-center gap-2 p-4 text-center",
        className,
      )}
    >
      {reason ? (
        <ShieldAlertIcon
          aria-hidden="true"
          className="text-muted-foreground aui-chat-icon-size-placeholder"
        />
      ) : (
        <ImageOffIcon
          aria-hidden="true"
          className="text-muted-foreground aui-chat-icon-size-placeholder"
        />
      )}
      <p className="text-sm font-medium">
        {t(stopped ? "assistant.image.stopped" : "assistant.image.failed")}
      </p>
      {reason && <p className="text-muted-foreground text-xs">{reason}</p>}
    </div>
  );
}

export type ImageActionsProps = {
  part: ImageMessagePart;
  /**
   * Wire to your own generation call to show a regenerate button. The button
   * renders only when this is set and the part carries a `prompt`.
   */
  onRegenerate?: () => void | Promise<void>;
  className?: string;
};

function RegenerateButton({ onRegenerate }: { onRegenerate: () => void | Promise<void> }) {
  const { t } = useI18n();
  const [isRegenerating, setIsRegenerating] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={async () => {
        setIsRegenerating(true);
        try {
          await onRegenerate();
        } finally {
          setIsRegenerating(false);
        }
      }}
      disabled={isRegenerating}
      data-slot="image-regenerate"
      aria-label={t("assistant.image.regenerate")}
    >
      <RefreshCwIcon className={cn(isRegenerating && "animate-spin")} />
    </Button>
  );
}

function ImageActions({ part, onRegenerate, className }: ImageActionsProps) {
  const { t } = useI18n();
  const { isCopied, runCopy, status } = useCopyFeedback();
  const copyLabel = t(
    status === "copied"
      ? "assistant.actions.copied"
      : status === "failed"
        ? "assistant.actions.copyFailed"
        : "assistant.image.copy",
  );

  return (
    <div data-slot="image-actions" className={cn("flex items-center gap-1 p-1", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => downloadImagePart(part)}
        data-slot="image-download"
        aria-label={t("assistant.image.download")}
      >
        <DownloadIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => void runCopy(() => copyImagePart(part).then(() => true))}
        data-slot="image-copy"
        aria-label={copyLabel}
        title={copyLabel}
      >
        {isCopied ? (
          <CheckIcon />
        ) : status === "failed" ? (
          <CircleXIcon className="text-destructive" />
        ) : (
          <CopyIcon />
        )}
      </Button>
      {onRegenerate && <RegenerateButton onRegenerate={onRegenerate} />}
    </div>
  );
}

const ImageImpl: FC<ImageMessagePart> = (props) => {
  const { t } = useI18n();
  const { image, filename, status } = props;

  return (
    <ImageRoot
      data-slot="image-generation"
      variant="ghost"
      className="aspect-square w-full bg-muted"
    >
      {status?.type === "running" ? (
        <ImageGenerating />
      ) : status?.type === "incomplete" || !image ? (
        <ImageContentFilterError
          className="h-full"
          stopped={
            status?.type === "incomplete" &&
            status.reason !== "error" &&
            status.reason !== "content-filter"
          }
          reason={
            status?.type === "incomplete" && status.reason === "content-filter"
              ? t("assistant.image.providerBlocked")
              : undefined
          }
        />
      ) : (
        <ImageZoom src={image} alt={filename || t("assistant.image.contentAlt")} className="h-full">
          <ImagePreview
            src={image}
            alt={filename || t("assistant.image.contentAlt")}
            containerClassName="h-full"
            className="h-full"
            loadingPlaceholder={<ImageGenerating className="absolute inset-0 h-full" />}
          />
        </ImageZoom>
      )}
    </ImageRoot>
  );
};

const Image = Object.assign(memo(ImageImpl), {
  Root: ImageRoot,
  Preview: ImagePreview,
  Filename: ImageFilename,
  Zoom: ImageZoom,
  Actions: ImageActions,
  Generating: ImageGenerating,
  ContentFilterError: ImageContentFilterError,
});

Image.displayName = "Image";

export {
  Image,
  ImageRoot,
  ImagePreview,
  ImageFilename,
  ImageZoom,
  ImageActions,
  ImageGenerating,
  ImageContentFilterError,
  imageVariants,
};
