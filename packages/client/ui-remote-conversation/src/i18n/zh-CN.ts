import type { MessageFormatters } from "@workbench/i18n/runtime";

export const messages = {
  remoteConversation: {
    empty: "还没有消息。",
    loadOlder: "加载更早的消息",
    loading: "正在加载对话…",
    loadError: "无法加载此对话。",
    toolRunning: "正在执行",
    toolCompleted: "已完成",
    toolFailed: "执行失败",
    toolInput: "输入",
    toolOutput: "原始输出",
    toolTruncated: "此工具转录超出远程传输上限，已截断。",
    messageTruncated: "此消息超出远程传输上限，已截断。",
    activityRunning: "正在执行",
    activityCompleted: "已完成",
    activityFailed: "执行失败",
    stopped: "运行已停止",
    failed: "运行失败",
    assistantWorking: "正在工作…",
    contextComposed: "上下文已组成",
    composingContext: "正在组成上下文",
    systemPromptInjected: "已注入系统提示词",
    toolsInjected: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `已注入 ${number(count)} 个工具`,
    extensionsLoaded: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `已加载 ${number(count)} 个扩展`,
    contextDetails: "详情",
  },
} as const;
