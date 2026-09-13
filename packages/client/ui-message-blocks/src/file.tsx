"use client";
import { conversationTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";

import { memo, type FC } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import {
  FileIcon,
  FileTextIcon,
  ImageIcon,
  MusicIcon,
  VideoIcon,
  BracesIcon,
  DownloadIcon,
} from "lucide-react";

import { cn } from "@workbench/ui/utils";

interface FileMessagePartProps {
  readonly filename?: string;
  readonly data: string;
  readonly mimeType: string;
  readonly sourceType?: "url" | "id";
}

const fileVariants = cva(
  "aui-file-root inline-flex items-center gap-3 rounded-lg transition-colors",
  {
    variants: {
      variant: {
        outline: "border-border hover:bg-muted/50 border",
        ghost: "hover:bg-muted/50",
        muted: "bg-muted/50 hover:bg-muted/70",
      },
      size: {
        sm: "px-2.5 py-1.5 text-xs",
        default: "px-3 py-2 text-sm",
        lg: "px-4 py-3 text-base",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default",
    },
  },
);

function getMimeTypeIcon(mimeType: string): FC<{ className?: string }> {
  const type = mimeType.toLowerCase();
  if (type.startsWith("image/")) {
    return ImageIcon;
  }
  if (type === "application/pdf") {
    return FileTextIcon;
  }
  if (type === "application/json") {
    return BracesIcon;
  }
  if (type.startsWith("text/")) {
    return FileTextIcon;
  }
  if (type.startsWith("audio/")) {
    return MusicIcon;
  }
  if (type.startsWith("video/")) {
    return VideoIcon;
  }
  return FileIcon;
}

import { getBase64Size, getFileDataKind, formatFileSize } from "../lib/file-data";

export type FileRootProps = React.ComponentProps<"div"> & VariantProps<typeof fileVariants>;

function FileRoot({ className, variant, size, children, ...props }: FileRootProps) {
  return (
    <div
      data-slot="file-root"
      data-variant={variant}
      data-size={size}
      className={cn(fileVariants({ variant, size, className }))}
      {...props}
    >
      {children}
    </div>
  );
}

type FileIconDisplayProps = React.ComponentProps<"span"> & {
  mimeType?: string;
};

function FileIconDisplay({ mimeType, className, children, ...props }: FileIconDisplayProps) {
  const IconComponent = mimeType ? getMimeTypeIcon(mimeType) : FileIcon;

  return (
    <span
      data-slot="file-icon"
      className={cn("text-muted-foreground shrink-0", className)}
      {...props}
    >
      {children ?? (
        <IconComponent className="size-(--icon-size-xl) shrink-0 [--button-icon-size:var(--icon-size-xl)]" />
      )}
    </span>
  );
}

function FileName({ className, children, ...props }: React.ComponentProps<"span">) {
  const { t } = useI18n(conversationTranslationBundle);

  return (
    <span
      data-slot="file-name"
      className={cn("min-w-0 flex-1 truncate font-medium", className)}
      {...props}
    >
      {children || t("assistant.file.unnamed")}
    </span>
  );
}

type FileSizeProps = React.ComponentProps<"span"> & {
  bytes: number;
};

function FileSize({ bytes, className, ...props }: FileSizeProps) {
  const { number } = useI18n(conversationTranslationBundle);

  return (
    <span
      data-slot="file-size"
      className={cn("text-muted-foreground shrink-0", className)}
      {...props}
    >
      {formatFileSize(bytes, (value) => number(value, { maximumFractionDigits: 1 }))}
    </span>
  );
}

type FileDownloadProps = Omit<React.ComponentProps<"a">, "href"> & {
  data: string;
  mimeType: string;
  filename?: string;
  sourceType?: "url" | "id";
};

function FileDownload({
  data,
  mimeType,
  filename,
  sourceType,
  className,
  children,
  ...props
}: FileDownloadProps) {
  if (typeof data !== "string") return null;
  const kind = getFileDataKind(data, sourceType);
  if (kind === "id") return null;
  if (kind === "url" && !/^(https?:\/\/|blob:)/i.test(data)) return null;
  const href = kind === "base64" ? `data:${mimeType};base64,${data}` : data;

  return (
    <a
      data-slot="file-download"
      href={href}
      download={filename || "download"}
      {...(kind === "url" && { target: "_blank", rel: "noopener noreferrer" })}
      className={cn(
        "text-muted-foreground hover:bg-accent hover:text-accent-foreground shrink-0 rounded-md p-1 transition-colors",
        className,
      )}
      {...props}
    >
      {children || (
        <DownloadIcon className="size-(--icon-size-sm) shrink-0 [--button-icon-size:var(--icon-size-sm)]" />
      )}
    </a>
  );
}

const FileImpl: FC<FileMessagePartProps> = ({ filename, data, mimeType, sourceType }) => {
  const kind = getFileDataKind(data, sourceType);
  const showSize = typeof data === "string" && (kind === "base64" || kind === "data-uri");

  return (
    <FileRoot>
      <FileIconDisplay mimeType={mimeType} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <FileName>{filename}</FileName>
        {showSize && <FileSize bytes={getBase64Size(data)} className="text-xs" />}
      </div>
      <FileDownload
        data={data}
        mimeType={mimeType}
        {...(filename !== undefined && { filename })}
        {...(sourceType !== undefined && { sourceType })}
      />
    </FileRoot>
  );
};

const File = Object.assign(memo(FileImpl), {
  Root: FileRoot,
  Icon: FileIconDisplay,
  Name: FileName,
  Size: FileSize,
  Download: FileDownload,
});

File.displayName = "File";

export {
  File,
  FileRoot,
  FileIconDisplay,
  FileName,
  FileSize,
  FileDownload,
  fileVariants,
  getMimeTypeIcon,
  getFileDataKind,
  getBase64Size,
  formatFileSize,
};
