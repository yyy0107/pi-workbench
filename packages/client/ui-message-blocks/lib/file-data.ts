export type FileDataKind = "data-uri" | "url" | "base64" | "id";

export function getFileDataKind(data: string, sourceType?: "url" | "id"): FileDataKind {
  if (sourceType === "url" && /^data:/i.test(data)) return "data-uri";
  if (sourceType) return sourceType;
  if (/^data:/i.test(data)) return "data-uri";
  if (/^https?:\/\//i.test(data)) return "url";
  return "base64";
}

export function getBase64Size(base64: string): number {
  const commaIndex = base64.indexOf(",");
  const base64Data = commaIndex >= 0 ? base64.slice(commaIndex + 1) : base64;
  const padding = (base64Data.match(/=/g) || []).length;
  return Math.max(0, Math.floor((base64Data.length * 3) / 4) - padding);
}

export function formatFileSize(
  bytes: number,
  formatNumber: (value: number) => string = String,
): string {
  if (bytes < 1024) return `${formatNumber(bytes)} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(Math.round((bytes / 1024) * 10) / 10)} KB`;
  return `${formatNumber(Math.round((bytes / (1024 * 1024)) * 10) / 10)} MB`;
}
