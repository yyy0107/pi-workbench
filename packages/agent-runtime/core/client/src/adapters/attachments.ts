import type { AttachmentAdapter } from "@assistant-ui/react";
import {
  WORKBENCH_COMPOSER_ATTACHMENT_ACCEPT,
  createComposerAttachmentKey,
  readFileAsDataUrl,
} from "../composer-attachment";

export const workbenchAttachmentAdapter: AttachmentAdapter = {
  accept: WORKBENCH_COMPOSER_ATTACHMENT_ACCEPT,
  async add({ file }) {
    return {
      id: createComposerAttachmentKey(),
      type: file.type.startsWith("image/") ? "image" : "document",
      name: file.name,
      file,
      contentType: file.type,
      content: [],
      status: { type: "requires-action", reason: "composer-send" },
    };
  },
  async send(attachment) {
    const data = await readFileAsDataUrl(attachment.file);
    return {
      ...attachment,
      status: { type: "complete" },
      content: attachment.file.type.startsWith("image/")
        ? [{ type: "image", image: data }]
        : [
            {
              type: "file",
              data,
              mimeType: attachment.file.type || "application/pdf",
              filename: attachment.name,
            },
          ],
    };
  },
  async remove() {},
};
