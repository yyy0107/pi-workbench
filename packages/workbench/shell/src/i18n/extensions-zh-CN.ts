import type { MessageFormatters } from "@workbench/i18n/runtime";

export const extensionsZhCN = {
  generativeUi: {
    name: "生成式 UI",
    description: "渲染 AI 消息中经过组件白名单校验的生成式 UI 组件树。",
    placement: {
      surface: "AI 消息内的单个文本或生成式 UI Part",
      description:
        "当消息 Part 包含完整且通过白名单校验的组件树时，仅替换这个叶子 Part；未命中的内容继续使用原消息渲染器。",
    },
    preview: {
      title: "结构化回复",
      caption: "AI 消息组件",
      body: "此预览与消息中的实际组件共用同一组件库、主题变量和作用域样式。",
      action: "预览",
    },
  },
  shared: {
    capabilityUnavailable: "当前运行时不支持此功能。",
    copyMarkdown: "复制 Markdown",
    markdownCopied: "已复制 Markdown",
    markdownCopyFailed: "Markdown 复制失败",
    panelsCategory: "面板",
    fileTree: {
      tree: "工作区文件树",
      empty: "此工作区文件夹为空。",
      noMatches: "没有符合筛选条件的文件。",
      loading: "正在加载工作区文件…",
      loadError: "无法加载工作区文件。",
      retry: "重试",
      loadingDirectory: ({ name }: { name: string }) => `正在加载 ${name}…`,
      loadDirectoryError: ({ name }: { name: string }) => `无法加载 ${name}。`,
      retryDirectory: ({ name }: { name: string }) => `重新加载 ${name}`,
      emptyDirectory: ({ name }: { name: string }) => `${name} 为空。`,
      openError: ({ name }: { name: string }) => `无法打开 ${name}。`,
      truncated: "此文件夹内容较多，部分条目未显示。",
    },
    reviewableDiff: {
      discard: "丢弃",
      discardHunk: ({ range }: { range: string }) => `丢弃差异块 ${range}`,
      keep: "保留",
      keepAll: "保留全部",
      keepHunk: ({ range }: { range: string }) => `保留差异块 ${range}`,
      kept: "已保留",
      discarded: "已丢弃",
      remaining: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `还有 ${number(count)} 块待处理`,
      allReviewed: "已全部处理",
    },
  },
} as const;
