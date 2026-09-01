export const desktopRendererZhCN = {
  metadata: {
    description: "基于 assistant-ui 构建的可组合 AI 工作台。",
  },
  bootstrap: {
    title: "Pi Workbench",
    loading: "正在连接本地 Workbench Runtime…",
    failed: "无法初始化本地 Workbench Runtime。",
    retry: "重试",
  },
  runtime: {
    category: "桌面应用",
    restart: {
      title: "重启本地服务",
      description: "重启本地 Workbench Runtime 并重新加载桌面工作区。",
    },
  },
} as const;
