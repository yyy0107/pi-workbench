import type { MessageFormatters } from "@workbench/i18n/runtime";

export const messages = {
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Couldn't copy",
  plainText: "Text",
  expand: "Expand code block",
  collapse: "Collapse code block",
  unmodifiedLines: ({ count }: { count: number }, { number, plural }: MessageFormatters) =>
    `${number(count)} unmodified ${plural(count) === "one" ? "line" : "lines"}`,
} as const;
