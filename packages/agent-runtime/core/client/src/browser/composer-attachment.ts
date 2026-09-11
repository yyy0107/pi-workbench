import type { ComposerAttachment } from "@workbench/agent-runtime-contracts/conversation";

export const WORKBENCH_COMPOSER_ATTACHMENT_ACCEPT = "image/*,application/pdf,.pdf";

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

export async function composerAttachmentFromFile(file: File): Promise<ComposerAttachment> {
  const mediaType = file.type || (/\.pdf$/iu.test(file.name) ? "application/pdf" : "");
  if (!mediaType.startsWith("image/") && mediaType !== "application/pdf") {
    throw new TypeError(`Unsupported attachment type: ${mediaType || file.name}`);
  }
  return {
    key: createComposerAttachmentKey(),
    name: file.name,
    source: await readFileAsDataUrl(file),
    mediaType,
  };
}
