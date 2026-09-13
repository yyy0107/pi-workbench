import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  extensions: {
    sideChat: {
      title: "Temporary chat",
      indexedTitle: ({ sequence }: { sequence: number }, { number }: MessageFormatters) =>
        `Temporary chat (${number(sequence)})`,
      open: "Open temporary chat",
      creating: "Creating temporary chat…",
      promote: "Keep as conversation",
      promoteDescription: "Save this temporary chat as a regular conversation.",
      promoting: "Saving…",
    },
  },
};
