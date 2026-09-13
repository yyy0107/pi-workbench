import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  assistant: {
    composer: {
      removeFile: "移除文件",
    },
    attachment: {
      previewTitle: "图片附件预览",
      previewAlt: "附件预览",
      image: "图片",
      document: "文档",
      file: "文件",
      uploadFailed: "上传失败",
      accessibleLabel: ({ type, status }: { type: string; status: string }) =>
        `${type}附件${status}`,
      statusUploading: "，正在上传",
      statusFailed: "，上传失败",
    },
  },
  chatContent: {
    textAttachment: {
      title: "粘贴文本",
      saving: "正在保存…",
      ready: "已保存",
      failed: "粘贴文本保存失败",
      retry: "重试",
      remove: "移除粘贴文本",
      preview: "预览粘贴文本",
      restore: "在文本框显示",
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
  },
  composer: {
    close: "关闭",
  },
};
