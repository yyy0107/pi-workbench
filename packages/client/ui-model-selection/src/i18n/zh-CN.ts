import type { MessageFormatters } from "@workbench/i18n/runtime";

export const messages = {
  assistant: {
    model: {
      select: "选择模型",
      model: "模型",
      search: "搜索模型…",
      empty: "未找到模型。",
      thinking: "思考强度",
      reasoningEffort: "推理强度",
      fast: "快速高效",
      balanced: "性能均衡",
      capable: "能力最强",
      low: "低",
      medium: "中",
      high: "高",
    },
  },
  extensions: {
    modelSelector: {
      manageModels: "管理模型",
      required: "请先配置并选择模型",
      provider: "提供方",
      saving: "正在保存此会话的模型",
      noModels: "没有找到可用的 Pi 模型。",
      searchLabel: "搜索模型",
      searchPlaceholder: "搜索模型…",
      noSearchResults: "没有匹配的模型。",
      loadFailed: "无法加载 Pi 模型。",
      selectFailed: "无法更改此会话的模型。",
      currentUnavailable: "当前会话模型已不可用，请选择其他模型。",
      unavailable: "无法用于新请求",
      loadingMore: "正在加载更多模型",
      contextWindow: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count, { notation: "compact", maximumFractionDigits: 1 })} 上下文窗口`,
      off: "关闭",
      minimal: "最低",
      low: "低",
      medium: "中",
      high: "高",
      xhigh: "超高",
      max: "最高",
      thinking: "思考",
    },
  },
} as const;
