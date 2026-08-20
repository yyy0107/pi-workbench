import type { MessageFormatters } from "@/i18n/types";

export const rightWorkspaceZhCN = {
  region: "检查工作区",
  expand: "打开检查工作区",
  collapse: "关闭检查工作区",
  maximize: "最大化检查工作区",
  restore: "恢复检查工作区大小",
  resize: "调整检查工作区宽度",
  addSurface: "打开工作表面",
  tabs: "已打开的工作表面",
  closeTab: ({ title }: { title: string }) => `关闭 ${title}`,
  closeOthers: "关闭其他表面",
  closeAll: "关闭全部表面",
  pin: "固定表面",
  unpin: "取消固定表面",
  empty: {
    title: "打开工作区能力",
    description: "已启用的扩展可以在对话旁提供检查表面。",
  },
  status: {
    loading: "正在加载表面…",
    disconnected: "后台资源已断开连接。",
    permissionRequired: "继续操作需要获得权限。",
    resourceChanged: "资源已在当前视图外发生变化。",
    error: "无法加载此表面。",
    capabilityUnavailable: "提供此表面的扩展尚未启用。",
    retry: "重试",
  },
  feedback: {
    title: "工作区反馈",
    add: "添加反馈",
    placeholder: "描述你希望进行的修改…",
    save: "添加批注",
    cancel: "取消",
    remove: "移除反馈",
    pending: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `${number(count)} 条工作区批注`,
    composerHint: "这些批注会随下一条消息发送。",
  },
} as const;
