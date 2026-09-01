export type FileViewMode = "source" | "preview" | "diff";

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "ico",
  "jpeg",
  "jpg",
  "jxl",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
]);

const FILE_VIEWER_EXTENSIONS = new Set([
  "aac",
  "avif",
  "bmp",
  "csv",
  "doc",
  "docm",
  "docx",
  "dot",
  "dotm",
  "dotx",
  "flac",
  "fods",
  "gif",
  "heic",
  "heif",
  "hwp",
  "hwpx",
  "ico",
  "jpeg",
  "jpg",
  "jxl",
  "key",
  "m4a",
  "m3u8",
  "mid",
  "midi",
  "mp3",
  "mp4",
  "mpeg",
  "numbers",
  "odp",
  "ods",
  "odt",
  "ofd",
  "oga",
  "ogg",
  "opus",
  "pages",
  "pdf",
  "pot",
  "potm",
  "potx",
  "pps",
  "ppsm",
  "ppsx",
  "ppt",
  "pptm",
  "pptx",
  "png",
  "rtf",
  "svg",
  "tif",
  "tiff",
  "tsv",
  "wav",
  "weba",
  "webm",
  "webp",
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

function fileExtension(path: string | undefined): string | undefined {
  const match = path?.match(/\.([^.\\/]+)$/);
  return match?.[1]?.toLowerCase();
}

export function isMarkdownFile(path: string | undefined): boolean {
  return Boolean(path && /\.(?:md|markdown)$/i.test(path));
}

export function isFileViewerPreviewFile(path: string | undefined): boolean {
  const extension = fileExtension(path);
  return extension ? FILE_VIEWER_EXTENSIONS.has(extension) : false;
}

export function isImagePreviewFile(
  path: string | undefined,
  mediaType: string | undefined,
): boolean {
  if (mediaType?.trim().toLowerCase().startsWith("image/")) return true;
  const extension = fileExtension(path);
  return extension ? IMAGE_EXTENSIONS.has(extension) : false;
}

export function defaultFileViewMode(
  path: string | undefined,
  encoding: "utf-8" | null,
): FileViewMode {
  return encoding === null && isFileViewerPreviewFile(path) ? "preview" : "source";
}

export function resolveFileViewMode(
  path: string | undefined,
  requestedMode: FileViewMode | undefined,
): FileViewMode {
  if (requestedMode === "diff") return "diff";
  return (isMarkdownFile(path) || isFileViewerPreviewFile(path)) && requestedMode === "preview"
    ? "preview"
    : "source";
}

export function toggleFileViewMode(mode: FileViewMode): FileViewMode {
  return mode === "source" ? "preview" : "source";
}
