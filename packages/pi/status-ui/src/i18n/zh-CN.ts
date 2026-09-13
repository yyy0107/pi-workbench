export const messages = {
  extensions: {
    about: {
      title: "关于",
      productDescription: "一个为 Pi 深度适配的本地优先开发工作台",
      version: "版本",
      license: "许可证",
      source: "源代码",
      openSourceSoftware: "主要开源软件",
      contribute: "参与贡献",
      issues: "问题反馈",
      pullRequests: "贡献代码",
      openExternal: ({ label }: { label: string }) => `${label}（在外部打开）`,
      unavailable: "暂不可用",
    },
    connectionStatus: {
      loading: "正在加载",
      streaming: "正在生成",
      ready: "就绪",
      accessibleLabel: ({ status }: { status: string }) => `助手运行时：${status}`,
      description: "状态来自本地助手运行时",
      workbenchVersionDescription: ({
        productName,
        version,
      }: {
        productName: string;
        version: string;
      }) => `${productName} 版本 ${version}`,
      workbenchVersionLoading: ({ productName }: { productName: string }) =>
        `正在加载 ${productName} 版本`,
    },
    runningIndicator: {
      piLogoShine: "Pi 标志 · 高光扫过",
      piLogoShineInverted: "Pi 标志 · 反色高光扫过",
      piWordmarkOnLight: "像素字标 · 浅色主题",
      piWordmarkOnDark: "像素字标 · 深色主题",
    },
  },
};
