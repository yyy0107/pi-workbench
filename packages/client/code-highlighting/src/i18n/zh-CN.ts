import type { MessageFormatters } from "@workbench/i18n/runtime";

export const messages = {
  copy: "复制",
  copied: "已复制",
  copyFailed: "复制失败",
  plainText: "文本",
  expand: "展开代码块",
  collapse: "收起代码块",
  unmodifiedLines: ({ count }: { count: number }, { number }: MessageFormatters) =>
    `未修改 ${number(count)} 行`,
} as const;
