import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  extensions: {
    userMessageIndex: {
      navigationLabel: "User message index",
      jumpTo: ({ index }: { index: number }, { number }: MessageFormatters) =>
        `Jump to user message ${number(index)}`,
      nonTextPreview: "This message contains attachments or structured content.",
    },
  },
};
