export const messages = {
  workbench: {
    chat: {
      empty: {
        question: ({ productName }: { productName: string }) => `要在 ${productName} 完成什么？`,
        description: "提出问题、附加上下文，或在对话需要更多空间时打开工作台面板。",
        planProject: "帮我规划一个小项目",
        explainConcept: "用简单方式解释一个复杂概念",
        reviewIdea: "评审一个想法并找出其中的风险",
      },
      titles: {
        attachmentAnalysis: "附件分析",
        imageConversation: "图片会话",
      },
      edit: {
        label: "编辑消息",
        cancel: "取消",
        update: "更新",
      },
      loadingHistory: "正在加载会话历史…",
      working: ({ runtimeName }: { runtimeName: string }) => `${runtimeName} Working...`,
      workingElapsed: ({ runtimeName, duration }: { runtimeName: string; duration: string }) =>
        `${runtimeName} Working... · ${duration}`,
      elapsedOnly: ({ duration }: { duration: string }) => `· ${duration}`,
      connectionInterruptedRetrying: ({
        attempt,
        maxAttempts,
      }: {
        attempt: number;
        maxAttempts: number;
      }) => `连接中断，正在重试 ${attempt}/${maxAttempts}`,
      connectionInterruptedRetryingElapsed: ({
        attempt,
        maxAttempts,
        duration,
      }: {
        attempt: number;
        maxAttempts: number;
        duration: string;
      }) => `连接中断，正在重试 ${attempt}/${maxAttempts} · ${duration}`,
      errors: {
        sessionBusy: "此会话正在生成回答。",
        emptyPrompt: "发送前请输入消息，或附加图片。",
        sessionNotFound: "此会话已不可用。",
        invalidWorkingDirectory: "运行时工作目录不可用。",
        invalidWorkspace: "请先选择有效的工作区，再开始会话。",
        modelNotAvailable: "当前配置的提供方不支持此模型。",
        requestFailed: "运行时未能完成请求，请重试。",
      },
      scrollLatest: "滚动到最新消息",
    },
  },
  assistant: {
    common: {
      close: "关闭",
      cancel: "取消",
      update: "更新",
    },
    thread: {
      greeting: "你好！",
      help: "今天想让我帮你做些什么？",
      thinking: "正在思考…",
      scrollLatest: "滚动到最新消息",
    },
    markdown: {
      footnotes: "脚注",
      backToReference: "返回引用",
    },
    codeBlock: {
      expand: "展开代码块",
      collapse: "收起代码块",
      plainText: "文本",
      mermaidDiagram: "Mermaid 图表",
      mermaidLoading: "正在渲染图表…",
      mermaidError: "Mermaid 图表渲染失败，请检查下方源码。",
    },
    linkSafety: {
      title: "打开外部链接？",
      description: "你即将访问外部网站。",
      copy: "复制链接",
      copied: "链接已复制",
      copyFailed: "链接复制失败",
      open: "打开链接",
    },
    branch: {
      previous: "上一个版本",
      next: "下一个版本",
    },
    threads: {
      search: "搜索会话",
      newChat: "新会话",
      newThread: "新建会话",
      loading: "正在加载会话",
      running: "正在生成",
      rename: "重命名会话",
      renameAction: "重命名",
      moreOptions: "更多选项",
      archive: "归档",
      delete: "删除",
      noResults: "未找到会话",
      today: "今天",
      yesterday: "昨天",
      earlier: "更早",
      sidebarTitle: "会话侧边栏",
      sidebarDescription: "显示会话列表。",
      toggleSidebar: "切换会话侧边栏",
    },
    context: {
      title: "上下文",
      system: "系统",
      tools: "工具",
      messages: "消息",
      total: "总计",
      usage: "上下文用量",
    },
    sourceLink: "查看源代码",
  },
};
