import type { MessageFormatters } from "@/i18n/types";

export const extensionsZhCN = {
  shared: {
    panelsCategory: "面板",
  },
  localeSelector: {
    label: "语言",
    current: ({ language }: { language: string }) => `语言：${language}`,
    switchTo: ({ language }: { language: string }) => `切换语言为${language}`,
    english: "English",
    chinese: "简体中文",
  },
  codeEditor: {
    title: "代码编辑器",
    toggleTitle: "切换代码编辑器",
    toggleDescription: "打开或关闭右侧代码编辑器面板",
    region: "代码编辑器",
    openedFiles: "打开的文件",
    closeFile: ({ name }: { name: string }) => `关闭 ${name}`,
    openFile: "打开文件",
    filePath: "文件路径",
    noOpenFile: "没有打开的文件",
    chooseLocalFiles: "选择本地文件",
    open: "打开",
    sourceCode: ({ name }: { name: string }) => `${name} 源代码`,
    emptyTitle: "打开一个代码文件",
    emptyDescription: "文件只在当前浏览器会话中读取，不会上传。",
    chooseFiles: "选择文件",
  },
  connectionStatus: {
    loading: "正在加载",
    streaming: "正在生成",
    ready: "就绪",
    accessibleLabel: ({ status }: { status: string }) => `助手运行时：${status}`,
    description: "状态来自本地助手运行时",
  },
  modelSelector: {
    locked: "生成过程中无法切换模型",
    noModels: "没有找到可用的 Pi 模型。",
    loadFailed: "无法加载 Pi 模型。",
    loadingMore: "正在加载更多模型",
    contextWindow: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `${number(count, { notation: "compact", maximumFractionDigits: 1 })} 上下文窗口`,
    low: "低",
    medium: "中",
    high: "高",
    thinking: "思考",
  },
  messagePresentation: {
    generating: "正在生成回答…",
    sourceFallback: "来源",
    completedTurn: ({ duration }: { duration: string }) =>
      duration ? `已完成 ${duration}` : "已完成",
    toolTimeline: {
      active: (
        { steps, files }: { steps: number; files: number },
        { number }: MessageFormatters,
      ) =>
        files > 0
          ? `正在工作 · ${number(steps)} 个步骤 · ${number(files)} 个文件已更改`
          : `正在工作 · ${number(steps)} 个步骤`,
      summary: (
        { steps, files }: { steps: number; files: number },
        { number }: MessageFormatters,
      ) =>
        files > 0
          ? `${number(steps)} 个步骤 · ${number(files)} 个文件已更改`
          : `${number(steps)} 个步骤`,
      steps: {
        thinking: "思考",
        read: "读取",
        ran: "运行",
        edited: "编辑",
        searched: "搜索",
        used: "调用",
      },
      activeSteps: {
        thinking: "正在思考",
        read: "正在读取",
        ran: "正在运行",
        edited: "正在编辑",
        searched: "正在搜索",
        used: "正在调用",
      },
      request: "请求",
      result: "结果",
    },
    reasoning: {
      active: "正在思考",
      complete: "已完成思考",
      completeWithDuration: ({ seconds }: { seconds: number }, { number }: MessageFormatters) =>
        `思考用时 ${number(seconds)} 秒`,
      elapsed: ({ seconds }: { seconds: number }, { number }: MessageFormatters) =>
        `${number(seconds)} 秒`,
      step: "思考过程",
    },
  },
  messageActions: {
    previousResponse: "上一个回答",
    nextResponse: "下一个回答",
    editMessage: "编辑消息",
    exportMarkdown: "导出为 Markdown",
    regenerateResponse: "重新生成回答",
    goodResponse: "回答很好",
    poorResponse: "回答欠佳",
    timing: {
      total: "总时间",
      firstToken: "首 token",
      inputTokens: "输入",
      outputTokens: "输出",
      tokensPerSecond: "TPS",
      cacheHitRate: "缓存命中",
    },
  },
  skills: {
    title: "技能",
    add: "添加技能",
    toggle: "切换技能面板",
    summary: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `技能 ${number(count)}`,
    intro: "启用此工作台预览中可用的本地能力。",
    search: "搜索技能",
    noMatches: "没有匹配的技能",
    broaderSearch: "请尝试更宽泛的搜索词。",
    enabledCount: ({ enabled, total }: { enabled: number; total: number }) =>
      `已在本地启用 ${enabled}/${total} 项`,
    items: {
      research: {
        title: "研究",
        category: "知识",
        description: "查找、比较并综合可信来源。",
      },
      codeReview: {
        title: "代码审查",
        category: "开发",
        description: "检查变更中的缺陷和可维护性风险。",
      },
      documents: {
        title: "文档",
        category: "效率",
        description: "起草并完善结构化文档。",
      },
      visualStudio: {
        title: "视觉工作室",
        category: "创意",
        description: "规划并创建精美的视觉素材。",
      },
      dataAnalysis: {
        title: "数据分析",
        category: "分析",
        description: "探索数据集并发现有用规律。",
      },
      browser: {
        title: "浏览器控制",
        category: "自动化",
        description: "导航并检查基于浏览器的工作流程。",
      },
    },
  },
  terminal: {
    title: "终端",
    toggleTitle: "切换终端",
    toggleDescription: "打开或关闭终端面板",
    session: "模拟会话 · 命令仅在当前浏览器中运行",
    clear: "清空终端",
    output: "终端输出",
    input: "模拟终端命令",
    welcome: "Workbench 终端 · 前端预览",
    hint: '输入 "help" 查看可用的模拟命令。',
    helpCommands: "可用命令：help、pwd、whoami、git status、pnpm dev、clear",
    helpSafety: "命令仅在本地模拟，不会发送到真实 Shell。",
    gitBranch: "当前分支 codex/workbench-v1",
    gitStatus: "模拟会话——此处不会检查真实仓库状态。",
    devNotStarted: "仅为模拟——没有启动任何进程。",
    devHint: "请使用真实项目终端运行 pnpm 命令。",
    unavailable: ({ command }: { command: string }) => `模拟：命令不可用：${command}`,
    unavailableHint: '输入 "help" 查看支持的预览命令。',
    tool: {
      running: "正在运行",
      complete: "已完成",
      failed: "运行失败",
      waiting: "等待授权",
      open: "打开终端",
    },
  },
  tokenUsage: {
    accessibleLabel: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `此会话约含 ${number(count)} 个 token`,
    display: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `≈ ${number(count)} tokens`,
    description: "根据当前可见会话内容进行的前端估算",
  },
  workspaceDirectory: {
    add: "添加本地工作区",
    newThread: "新会话",
    defaultName: "请选择工作区",
    localPi: "本地 Pi",
    selectTitle: "选择工作区",
    selectDescription: "为新会话选择一个服务端目录。",
    path: "工作区路径",
    pathPlaceholder: "/工作区/路径 或 ~/workspace",
    open: "打开",
    parent: "打开上级目录",
    loading: "正在加载目录…",
    empty: "没有子目录",
    selectCurrent: "使用此工作区",
    selecting: "正在选择…",
    cancel: "取消",
    close: "关闭工作区选择器",
    browseError: "无法打开此目录。",
    selectError: "无法选择此工作区。",
  },
} as const;
