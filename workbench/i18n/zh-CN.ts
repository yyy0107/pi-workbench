import type { MessageFormatters } from "@/i18n/types";

export const workbenchZhCN = {
  chat: {
    empty: {
      question: "要在 Pi Workbench 完成什么？",
      description: "提出问题、附加上下文，或在对话需要更多空间时打开工作台面板。",
      workspaceQuestion: "选择一个工作区开始",
      workspaceDescription: "Pi 需要工作区来读取和修改项目文件。",
      planProject: "帮我规划一个小项目",
      explainConcept: "用简单方式解释一个复杂概念",
      reviewIdea: "评审一个想法并找出其中的风险",
    },
    composer: {
      placeholder: "描述你想完成的任务，或粘贴需要处理的内容…",
      runningPlaceholder: "按下 Enter 发送排队消息，按下 Ctrl+Enter 直接发送引导消息…",
      selectWorkspacePlaceholder: "请先选择工作区，再开始会话…",
      messageInput: "消息输入框",
      commandSuggestions: "命令建议",
      commandParameters: {
        close: "关闭命令参数面板",
        edit: ({ command }: { command: string }) => `编辑 ${command} 的参数`,
        enabled: "启用",
        optional: "可选",
        required: "必填",
        valuePlaceholder: ({ parameter }: { parameter: string }) => `填写${parameter}`,
      },
      commandGroups: {
        builtin: "Pi 内置命令",
        extension: "扩展命令",
        prompt: "提示词模板",
        skill: "Skills",
        workbench: "Workbench",
      },
      builtinCommands: {
        compact: {
          label: "压缩上下文",
          description: "手动压缩当前会话上下文",
          argumentHint: "[可选压缩指令]",
        },
        reload: {
          label: "重新加载",
          description: "重新加载扩展、Skills、提示词与上下文文件",
        },
      },
      stopVoiceInput: "停止语音输入",
      voiceInput: "语音输入",
      stopGenerating: "停止生成",
      sendMessage: "发送消息",
      queueFollowUp: "加入后续队列",
      dismissError: "关闭提示",
      openDrawer: "显示输入选项",
      closeDrawer: "隐藏输入选项",
      drawer: "输入选项",
      contextCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `上下文 ${number(count)}`,
      extensionsCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `扩展 ${number(count)}`,
    },
    titles: {
      attachmentAnalysis: "附件分析",
      imageConversation: "图片会话",
    },
    actions: {
      copyMessage: "复制消息",
      copyResponse: "复制回答",
    },
    edit: {
      label: "编辑消息",
      cancel: "取消",
      update: "更新",
    },
    sourceFallback: "来源",
    generating: "正在生成回答…",
    working: "Pi Working...",
    workingElapsed: ({ duration }: { duration: string }) => `Pi Working... · ${duration}`,
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
    commandResponses: {
      compactRunning: "正在压缩上下文…",
      compactSucceeded: "会话上下文已压缩。",
      compactFailed: "无法压缩会话上下文。",
      reloadRunning: "正在重新加载扩展、Skills、提示词和上下文文件…",
      reloadSucceeded: "已重新加载扩展、Skills、提示词和上下文文件。",
      reloadFailed: "无法重新加载扩展、Skills、提示词和上下文文件。",
      commandRunning: ({ command }: { command: string }) => `${command} 正在执行…`,
      commandSucceeded: ({ command }: { command: string }) => `${command} 已完成。`,
      commandFailed: ({ command }: { command: string }) => `${command} 未能完成。`,
    },
    separators: {
      continuedFromChat: "从聊天中继续",
      modelChanged: "模型已切换",
      modelChangedAnnouncement: ({
        previousModel,
        model,
      }: {
        previousModel?: string;
        model: string;
      }) => (previousModel ? `模型已从 ${previousModel} 切换为 ${model}` : `模型已切换为 ${model}`),
      contextCompacted: "会话上下文已压缩",
      contextCompactedTokens: (
        { before, after }: { before: number; after: number },
        { number }: MessageFormatters,
      ) =>
        `${number(before, { notation: "compact" })} → ${number(after, { notation: "compact" })} tokens`,
      contextCompactedBefore: ({ before }: { before: number }, { number }: MessageFormatters) =>
        `压缩前 ${number(before, { notation: "compact" })} tokens`,
      contextCompactedAnnouncement: (
        { before, after }: { before?: number; after?: number },
        { number }: MessageFormatters,
      ) =>
        before !== undefined && after !== undefined
          ? `会话上下文已从 ${number(before)} tokens 压缩至约 ${number(after)} tokens`
          : before !== undefined
            ? `会话上下文已从 ${number(before)} tokens 压缩`
            : "会话上下文已压缩",
    },
    errors: {
      sessionBusy: "此会话正在生成回答。",
      emptyPrompt: "发送前请输入消息，或附加图片、PDF。",
      sessionNotFound: "此会话已不可用。",
      invalidWorkingDirectory: "Pi 工作目录不可用。",
      invalidWorkspace: "请先选择有效的工作区，再开始会话。",
      modelNotAvailable: "当前配置的 Pi Provider 不支持此模型。",
      modelDoesNotSupportAttachments: "当前路由无法接收此附件。请移除附件或选择兼容的识别路由。",
      invalidAttachment: "无法发送此附件。请使用有效的 PNG、JPEG、GIF、WebP 或 PDF 文件。",
      attachmentTooLarge: "附件过大，无法发送。请选择较小的文件。",
      tooManyAttachments: "一次发送的附件过多。请移除部分文件后重试。",
      requestFailed: "Pi 未能完成请求，请重试。",
      commandCompileFailed: "无法发送当前命令组合。请删除冲突或已不可用的命令 Token 后重试。",
      retry: "重试",
      retrying: "正在重试",
      continue: "继续",
      continuing: "正在继续",
      generationStopped: "生成已停止",
      generationInterrupted: "生成已中止",
      connectionFailed: "连接失败",
      requestFailedTitle: "请求失败",
      stoppedByUser: "用户已手动停止本次回答。",
      interrupted: "回答在完成前意外中止。",
      stoppedCanContinue: "本次回答已停止。继续将接着完成当前任务。",
      interruptedCanContinue: "中止点已保存。继续将从最近的安全位置接着完成当前任务。",
      continueFailed: "未能继续当前任务。请刷新会话后再试。",
      resumeRequiresConfirmation:
        "中止前有工具可能已改变外部状态。在确认工具结果前，无法自动继续。",
      resumeRequiresModelChange: "中止点已保存。请切换到有可用额度或权限的模型或 Provider 后继续。",
      outputLimit: ({ tokens }: { tokens?: number }, { number }: MessageFormatters) =>
        tokens === undefined
          ? "模型已达到输出长度上限。"
          : `模型在输出 ${number(tokens)} tokens 后达到长度上限。`,
      networkFailure: "与模型 Provider 的连接已中断。",
      apiFailure: "模型 Provider 未能完成该请求。",
      providerFailure: "当前配置的模型 Provider 未能完成该请求。",
      queueSendFailedRestored: "消息排队失败，草稿已恢复，你可以再次尝试发送。",
      unknownFailure: "本次回答未能完成。",
    },
    scrollLatest: "滚动到最新消息",
  },
  sidebar: {
    newThread: "新建会话",
    toolbox: "工具箱",
    workflows: "流程",
    search: "搜索会话",
    searchPlaceholder: "搜索会话…",
    searchToolbox: "搜索工具箱",
    searchToolboxPlaceholder: "搜索能力…",
    searchWorkflows: "搜索流程",
    searchWorkflowsPlaceholder: "搜索流程…",
    clearSearch: "清除搜索",
    closeSearch: "关闭搜索",
    noSearchResults: "没有找到匹配的会话。",
    toolboxEmpty: "工具箱内容将在这里显示。",
    workflowsEmpty: "流程内容将在这里显示。",
    workspaceOptions: "工作区选项",
    conversationOptions: "会话选项",
    removeWorkspace: "移除工作区",
    expandWorkspace: "展开工作区",
    collapseWorkspace: "收起工作区",
    expandSection: "展开分区",
    collapseSection: "收起分区",
    conversations: "会话",
    loading: "正在加载会话",
    loadingMoreWorkspaces: "正在加载更多工作区",
    empty: "发送第一条消息后，会话会显示在这里。",
    noWorkspaces: "添加工作区后即可开始会话。",
    pinned: "置顶",
    projects: "项目",
    chatSortTitle: "聊天排序方式",
    chatSortManual: "手动排序",
    chatSortPriority: "优先级",
    chatSortRecent: "最近更新",
    ungrouped: "未分组会话",
    loadMore: "显示更多",
    generating: "正在生成",
    completed: "已在后台完成",
    pin: "置顶会话",
    unpin: "取消置顶会话",
    pinWorkspace: "置顶项目",
    unpinWorkspace: "取消置顶项目",
    archive: "归档会话",
    delete: "删除会话",
    resize: "调整会话侧边栏宽度",
    mobileTitle: "会话侧边栏",
    mobileDescription: "显示会话和工作区导航。",
    closeMobile: "关闭会话侧边栏",
    collapse: "收起侧边栏",
    expand: "展开侧边栏",
    openMobile: "打开会话侧边栏",
    mainNavigation: "主要导航",
    region: "会话侧边栏",
  },
  panels: {
    closePanel: "关闭面板",
    resize: ({ location }: { location: string }) => `调整${location}面板大小`,
    locations: {
      left: "左侧",
      right: "右侧",
      bottom: "底部",
    },
    expandRight: "展开右侧栏",
    collapseRight: "收起右侧栏",
    rightExtensions: "右侧栏扩展",
    closeTab: ({ label }: { label: string }) => `关闭 ${label}`,
    addTab: "添加右侧栏标签",
    noTabs: "暂无可添加的标签",
  },
  shell: {
    workspace: "工作区",
    workbench: "Workbench",
  },
} as const;
