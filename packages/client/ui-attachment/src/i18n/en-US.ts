import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  assistant: {
    composer: {
      removeFile: "Remove file",
    },
    attachment: {
      previewTitle: "Image attachment preview",
      previewAlt: "Attachment preview",
      image: "Image",
      document: "Document",
      file: "File",
      uploadFailed: "Upload failed",
      accessibleLabel: ({ type, status }: { type: string; status: string }) =>
        `${type} attachment${status}`,
      statusUploading: ", uploading",
      statusFailed: ", upload failed",
    },
  },
  chatContent: {
    textAttachment: {
      title: "Pasted text",
      saving: "Saving…",
      ready: "Saved",
      failed: "Could not save pasted text",
      retry: "Retry",
      remove: "Remove pasted text",
      preview: "Preview pasted text",
      restore: "Show in text box",
      restoring: "Restoring…",
      restoreFailed: "Could not restore pasted text. The attachment has been kept.",
      unavailable: "This text attachment is unavailable.",
      loadMore: "Load more",
      loading: "Loading…",
      tooLarge: "Pasted text exceeds the 5 MiB limit.",
      tooMany: "A message supports up to 20 attachments.",
      characters: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} characters`,
    },
  },
  composer: {
    close: "Close",
  },
};
