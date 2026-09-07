import type { MessageFormatters } from "../../i18n/types";

export const chatContentEnUS = {
  userMessage: { showMore: "Show more", showLess: "Show less" },
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
} as const;
