import type { AttachmentAdapter } from "@assistant-ui/react";

function createAttachmentId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error(`Unable to read ${file.name}`)),
    );
    reader.readAsDataURL(file);
  });
}

export const workbenchAttachmentAdapter: AttachmentAdapter = {
  accept: "image/*",
  async add({ file }) {
    return {
      id: createAttachmentId(),
      type: file.type.startsWith("image/") ? "image" : "file",
      name: file.name,
      file,
      contentType: file.type,
      content: [],
      status: { type: "requires-action", reason: "composer-send" },
    };
  },
  async send(attachment) {
    return {
      ...attachment,
      status: { type: "complete" },
      content: [{ type: "image", image: await readFileAsDataUrl(attachment.file) }],
    };
  },
  async remove() {},
};
