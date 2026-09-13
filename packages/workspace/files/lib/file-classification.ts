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

export function fileExtension(path: string | undefined): string | undefined {
  const match = path?.match(/\.([^.\\/]+)$/);
  return match?.[1]?.toLowerCase();
}

export function isMarkdownFile(path: string | undefined): boolean {
  return Boolean(path && /\.(?:md|markdown)$/i.test(path));
}

export function isImagePreviewFile(
  path: string | undefined,
  mediaType: string | undefined,
): boolean {
  if (mediaType?.trim().toLowerCase().startsWith("image/")) return true;
  const extension = fileExtension(path);
  return extension ? IMAGE_EXTENSIONS.has(extension) : false;
}
