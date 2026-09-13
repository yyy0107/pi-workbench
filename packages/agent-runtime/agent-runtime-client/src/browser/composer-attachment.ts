import type { ComposerAttachment } from "@workbench/agent-runtime-contracts/conversation";
import {
  MANAGED_FILE_MAX_BYTES,
  detectManagedImageMediaType,
} from "@workbench/agent-runtime-contracts/composer-attachments";

export const WORKBENCH_COMPOSER_ATTACHMENT_ACCEPT: string | undefined = undefined;

export function createComposerAttachmentKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error(`Unable to read ${file.name}`)),
    );
    reader.readAsDataURL(file);
  });
}

const IMAGE_MEDIA_TYPE_BY_EXTENSION = Object.freeze<Record<string, string>>({
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  jpe: "image/jpeg",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
});

function decodedBase64Prefix(data: string): Uint8Array | undefined {
  const prefixLength = Math.min(data.length, 24);
  const encodedPrefix = data.slice(0, prefixLength - (prefixLength % 4));
  if (!encodedPrefix) return undefined;
  try {
    const decoded = globalThis.atob(encodedPrefix);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

export function inferComposerAttachmentMediaType(
  name: string,
  declaredMediaType: string,
  source: string,
): string {
  const dataUrl = /^data:([^;,]*);base64,([\s\S]*)$/u.exec(source);
  const detected = detectManagedImageMediaType(decodedBase64Prefix(dataUrl?.[2] ?? "") ?? []);
  if (detected) return detected;

  const sourceMediaType = dataUrl?.[1] ?? "";
  for (const mediaType of [declaredMediaType, sourceMediaType]) {
    if (mediaType && mediaType !== "application/octet-stream") return mediaType;
  }

  const extension = /\.([^.]+)$/u.exec(name)?.[1]?.toLowerCase();
  return (
    (extension ? IMAGE_MEDIA_TYPE_BY_EXTENSION[extension] : undefined) ??
    (declaredMediaType || sourceMediaType || "application/octet-stream")
  );
}

export async function composerAttachmentFromFile(file: File): Promise<ComposerAttachment> {
  if (file.size > MANAGED_FILE_MAX_BYTES)
    throw new TypeError(`Attachment is too large: ${file.name}`);
  const source = await readFileAsDataUrl(file);
  const encoded = /^data:[^;,]*;base64,([\s\S]*)$/u.exec(source)?.[1];
  if (encoded === undefined) throw new TypeError(`Unable to encode attachment: ${file.name}`);
  const mediaType = inferComposerAttachmentMediaType(file.name, file.type, source);
  return {
    key: createComposerAttachmentKey(),
    name: file.name,
    source: `data:${mediaType};base64,${encoded}`,
    mediaType,
  };
}
