import type {
  WorkbenchLocalAppFileKind,
  WorkbenchLocalApp,
} from "@workbench/host-contracts/runtime-capabilities";

import { isImagePreviewFile } from "./file-view-mode";

const AUDIO_EXTENSIONS = new Set([
  "aac",
  "aiff",
  "alac",
  "flac",
  "m4a",
  "mid",
  "midi",
  "mp3",
  "oga",
  "ogg",
  "opus",
  "wav",
  "weba",
  "wma",
]);

const VIDEO_EXTENSIONS = new Set([
  "avi",
  "m2ts",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "ts",
  "webm",
  "wmv",
]);

const DOCUMENT_EXTENSIONS = new Set([
  "doc",
  "docm",
  "docx",
  "dot",
  "dotm",
  "dotx",
  "hwp",
  "hwpx",
  "key",
  "numbers",
  "odp",
  "ods",
  "odt",
  "ofd",
  "pages",
  "pot",
  "potm",
  "potx",
  "pps",
  "ppsm",
  "ppsx",
  "ppt",
  "pptm",
  "pptx",
  "rtf",
  "wp",
  "wp5",
  "wp6",
  "wpd",
  "xla",
  "xlam",
  "xls",
  "xlsb",
  "xlsm",
  "xlsx",
  "xlt",
  "xltm",
  "xltx",
]);

const ARCHIVE_EXTENSIONS = new Set([
  "7z",
  "bz2",
  "gz",
  "rar",
  "tar",
  "tbz",
  "tbz2",
  "tgz",
  "txz",
  "xz",
  "zip",
  "zst",
]);

function fileExtension(path: string | undefined): string | undefined {
  return path?.match(/\.([^.\\/]+)$/)?.[1]?.toLowerCase();
}

export function localAppFileKindFor(
  path: string | undefined,
  mediaType: string | undefined,
  encoding: "utf-8" | null | undefined,
): WorkbenchLocalAppFileKind {
  const normalizedMediaType = mediaType?.split(";", 1)[0]?.trim().toLowerCase();
  const extension = fileExtension(path);

  if (normalizedMediaType?.startsWith("image/") || isImagePreviewFile(path, mediaType)) {
    return "image";
  }
  if (normalizedMediaType?.startsWith("audio/")) return "audio";
  if (normalizedMediaType?.startsWith("video/")) return "video";
  if (normalizedMediaType === "application/pdf" || extension === "pdf") return "pdf";
  if (
    normalizedMediaType === "application/zip" ||
    normalizedMediaType === "application/gzip" ||
    normalizedMediaType?.startsWith("application/x-7z") ||
    normalizedMediaType?.startsWith("application/x-rar") ||
    normalizedMediaType?.startsWith("application/x-tar") ||
    (extension && ARCHIVE_EXTENSIONS.has(extension))
  ) {
    return "archive";
  }
  if (
    normalizedMediaType === "application/rtf" ||
    normalizedMediaType?.startsWith("application/vnd.") ||
    (extension && DOCUMENT_EXTENSIONS.has(extension))
  ) {
    return "document";
  }
  if (encoding === "utf-8" || normalizedMediaType?.startsWith("text/")) return "text";
  if (extension && AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (extension && VIDEO_EXTENSIONS.has(extension)) return "video";
  return "other";
}

export function compatibleLocalFileApps(
  apps: readonly WorkbenchLocalApp[],
  fileKind: WorkbenchLocalAppFileKind,
): WorkbenchLocalApp[] {
  return apps.filter(
    (app) =>
      app.kind !== "terminal" &&
      app.kind !== "file-manager" &&
      app.supportedFileKinds.includes(fileKind),
  );
}

export function localSystemApps(apps: readonly WorkbenchLocalApp[]): WorkbenchLocalApp[] {
  return apps.filter((app) => app.kind === "terminal" || app.kind === "file-manager");
}

export function compatibleLocalFolderApps(apps: readonly WorkbenchLocalApp[]): WorkbenchLocalApp[] {
  return apps.filter((app) => app.kind === "editor");
}
