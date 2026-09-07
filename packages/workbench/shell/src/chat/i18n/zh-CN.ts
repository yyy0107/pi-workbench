import type { MessageFormatters } from "../../i18n/types";

export const chatContentZhCN = {
  userMessage: { showMore: "显示更多", showLess: "收起" },
  textAttachment: {
    title: "粘贴文本",
    saving: "正在保存…",
    ready: "已保存",
    failed: "粘贴文本保存失败",
    retry: "重试",
    remove: "移除粘贴文本",
    preview: "预览粘贴文本",
    restore: "恢复到输入框",
    restoring: "正在恢复…",
    restoreFailed: "无法恢复粘贴文本，附件已保留。",
    unavailable: "此文本附件不可用。",
    loadMore: "加载更多",
    loading: "正在加载…",
    tooLarge: "粘贴文本超过 5 MiB 上限。",
    tooMany: "一条消息最多支持 20 个附件。",
    characters: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `${number(count)} 个字符`,
  },
} as const;
