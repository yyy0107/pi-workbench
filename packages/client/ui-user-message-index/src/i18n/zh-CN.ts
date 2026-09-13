import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  extensions: {
    userMessageIndex: {
      navigationLabel: "用户消息索引",
      jumpTo: ({ index }: { index: number }, { number }: MessageFormatters) =>
        `跳转到第 ${number(index)} 条用户消息`,
      nonTextPreview: "此消息包含附件或结构化内容。",
    },
  },
};
