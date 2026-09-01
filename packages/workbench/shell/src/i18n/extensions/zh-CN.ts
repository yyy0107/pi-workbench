import type { MessageFormatters } from "../types";

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

  localeSelector: {
    languageTitle: "语言",
    languageDescription: "选择工作台控件和菜单使用的语言。",
    selectLanguage: "选择界面语言",
  },
  hardwareAcceleration: {
    enable: "启用硬件加速",
    description:
      "使用 GPU 渲染桌面界面和工作流画布。若出现画面异常、黑屏或显卡驱动崩溃，可关闭此项；更改将在重启后生效。",
    restartRequired: "已保存。重启 Workbench 后生效。",
    saveError: "无法保存此设置，请检查连接后重试。",
  },
  settings: {
    title: "设置",
    category: "工作台",
    trigger: "设置",
    open: "打开设置",
    openDescription: "打开工作台设置",
    close: "关闭设置",
    backToApp: "返回应用",
    searchLabel: "搜索设置",
    searchPlaceholder: "搜索设置…",
    noSearchResults: "没有匹配的设置，请尝试其他关键词。",
    sections: "设置分区",
    empty: "当前没有可用的设置分区。",
    emptySection: "此分区暂时没有可用的设置项。",
    groups: {
      basics: "基础",
      appearance: "外观",
      intelligence: "智能",
      capabilities: "能力",
      data: "数据",
    },
    general: {
      title: "常规",
      description: "配置语言及其他工作台通用偏好。",
    },
  },

  archivedChats: {
    title: "归档",
    description: "查看、恢复或永久删除已经归档的聊天。",
    searchLabel: "搜索已归档聊天",
    searchPlaceholder: "搜索已归档聊天",
    sortLabel: "排序已归档聊天",
    newestFirst: "最新优先",
    oldestFirst: "最早优先",
    projectFilterLabel: "按项目筛选已归档聊天",
    allProjects: "所有项目",
    ungroupedProject: "其他聊天",
    totalCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `共 ${number(count)} 个已归档聊天`,
    groupCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `${number(count)} 个聊天`,
    untitled: "未命名聊天",
    loading: "正在加载已归档聊天…",
    loadingMore: "正在加载更多已归档聊天…",
    empty: "目前没有已归档的聊天。",
    noMatches: "没有符合当前筛选条件的已归档聊天。",
    unarchive: "取消归档",
    working: "处理中…",
    delete: "删除",
    deleteChat: ({ title }: { title: string }) => `删除${title}`,
    deleteAll: "全部删除",
    actionFailed: "无法更新已归档聊天，请重试。",
    deleteDialogTitle: "永久删除已归档聊天？",
    deleteChatDescription: ({ title }: { title: string }) =>
      `“${title}”及其完整聊天记录将被永久删除，此操作无法撤销。`,
    deleteAllDescription: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `全部 ${number(count)} 个已归档聊天及其完整记录将被永久删除，此操作无法撤销。`,
    cancel: "取消",
    confirmDelete: "永久删除",
    deleting: "正在删除…",
  },

  appearance: {
    title: "主题",
    description: "选择明暗模式，并分别调整浅色与深色主题配色。",
    theme: {
      title: "主题",
      description: "跟随操作系统，或让工作台固定使用一种明暗模式。",
      mode: "明暗模式",
    },
    colorModes: {
      system: "系统",
      light: "浅色",
      dark: "深色",
    },
    palette: {
      title: "主题颜色",
      description: "在同一处查看和调整完整的浅色与深色配色。",
    },
    themeSettings: {
      accent: "强调色",
      background: "基础色",
      foreground: "前景",
      contrast: "对比度",
      lightAccent: "浅色主题强调色",
      lightBackground: "浅色主题基础色",
      lightForeground: "浅色主题前景色",
      lightContrast: "浅色主题对比度",
      darkAccent: "深色主题强调色",
      darkBackground: "深色主题基础色",
      darkForeground: "深色主题前景色",
      darkContrast: "深色主题对比度",
      contrastValue: ({ contrast }: { contrast: number }, { number }: MessageFormatters) =>
        `${number(contrast)}%`,
    },
    typography: {
      title: "字体",
      description: "选择界面字体并调整 UI 文字的基准大小。",
      font: "UI 字体",
    },
    interface: {
      sectionTitle: "界面",
      description: "调整界面字体、控件尺寸、运行状态指示器、组件表面、边框和圆角。",
    },
    runningIndicator: {
      title: "运行中的会话",
      description: "选择左侧会话列表中用于表示正在运行的动画。",
      style: "指示器样式",
      styles: {
        orb: "轨道粒子",
        spinner: "旋转加载",
        pulse: "脉冲圆点",
        none: "不显示",
      },
    },
    activityAnimation: {
      title: "助手活动动画",
      description: "选择助手在会话中工作时显示的动画。",
      style: "动画样式",
      size: "动画大小",
      sizeDescription: "调整行内动画大小，不改变活动状态行的高度。",
      sizeValue: ({ size }: { size: number }, { number }: MessageFormatters) =>
        `${number(size)} 像素`,
      styles: {
        working: "工作 · 轨道粒子",
        searching: "搜索 · 扫描球体",
        solving: "求解 · 重组环带",
        listening: "聆听 · 滚动波形",
        connecting: "连接 · 星座连线",
        weaving: "编织 · 交错丝带",
        composing: "组织 · 起伏环带",
        breathing: "呼吸 · 渐变圆环",
        shaping: "塑形 · 几何轮廓",
      },
    },
    controls: {
      title: "控件高度",
      controlHeight: "表单控件高度",
      controlHeightDescription: "统一设置共享输入框、下拉框和按钮的高度，保持同行对齐。",
      switchHeight: "开关高度",
      switchHeightDescription: "按比例调整标准和紧凑开关的尺寸。",
      heightValue: ({ height }: { height: number }, { number }: MessageFormatters) =>
        `${number(height)} 像素`,
      preview: {
        title: "实时预览",
        inputLabel: "输入框",
        inputPlaceholder: "输入一些内容…",
        dropdownLabel: "下拉框",
        dropdownPrimary: "舒适",
        dropdownSecondary: "紧凑",
        buttonLabel: "按钮",
        buttonValue: "继续",
        switchLabel: "开关",
        switchValue: "已启用",
      },
    },
    fontFamilies: {
      ui: {
        system: "系统字体",
        geist: "Geist",
        serif: "衬线字体",
        rounded: "圆体",
      },
      code: {
        geistMono: "Geist Mono",
        systemMono: "系统等宽字体",
        compactMono: "紧凑等宽字体",
        jetBrainsMono: "JetBrains Mono",
        firaCode: "Fira Code",
        cascadiaCode: "Cascadia Code",
        sourceCodePro: "Source Code Pro",
        ibmPlexMono: "IBM Plex Mono",
        menlo: "Menlo",
        consolas: "Consolas",
        liberationMono: "Liberation Mono",
        ubuntuMono: "Ubuntu Mono",
      },
    },
    codeThemes: {
      "dark-plus": "VS Code Dark Plus",
      "light-plus": "VS Code Light Plus",
      "github-dark": "GitHub Dark",
      "github-dark-dimmed": "GitHub Dark Dimmed",
      "github-dark-high-contrast": "GitHub Dark High Contrast",
      "github-light": "GitHub Light",
      "github-light-high-contrast": "GitHub Light High Contrast",
      "one-dark-pro": "One Dark Pro",
      "one-light": "One Light",
      dracula: "Dracula",
      "dracula-soft": "Dracula Soft",
      "ayu-dark": "Ayu Dark",
      "tokyo-night": "Tokyo Night",
      "night-owl": "Night Owl",
      monokai: "Monokai",
      "min-dark": "Min Dark",
      "min-light": "Min Light",
      nord: "Nord",
      "slack-dark": "Slack Dark",
      "slack-ochin": "Slack Ochin",
      vesper: "Vesper",
      "vitesse-dark": "Vitesse Dark",
      "vitesse-light": "Vitesse Light",
      "catppuccin-mocha": "Catppuccin Mocha",
      "catppuccin-macchiato": "Catppuccin Macchiato",
      "catppuccin-frappe": "Catppuccin Frappé",
      "catppuccin-latte": "Catppuccin Latte",
      "kanagawa-wave": "Kanagawa Wave",
      "kanagawa-dragon": "Kanagawa Dragon",
      "kanagawa-lotus": "Kanagawa Lotus",
      "everforest-dark": "Everforest Dark",
      "everforest-light": "Everforest Light",
      "gruvbox-dark-medium": "Gruvbox Dark Medium",
      "gruvbox-light-medium": "Gruvbox Light Medium",
      "material-theme": "Material Theme",
      "material-theme-ocean": "Material Theme Ocean",
      "material-theme-palenight": "Material Theme Palenight",
      "rose-pine": "Rosé Pine",
      "rose-pine-moon": "Rosé Pine Moon",
      "rose-pine-dawn": "Rosé Pine Dawn",
      "solarized-dark": "Solarized Dark",
      "solarized-light": "Solarized Light",
      "synthwave-84": "SynthWave '84",
    },
    background: {
      sectionTitle: "背景",
      title: "工作台背景",
      description: "使用自定义画布颜色或本地图片，营造独立于主题配色的工作台背景。",
      colorTitle: "画布颜色",
      imageTitle: "背景图片",
      image: "本地图片",
      custom: "使用自定义画布颜色",
      color: "画布颜色",
      syncSurfaces: "让面板和组件底色与画布协调",
      preview: "背景图片预览",
      chooseImage: "选择图片",
      replaceImage: "更换图片",
      removeImage: "移除背景图片",
      loadingImage: "正在加载图片…",
      blur: "图片模糊",
      unsupportedImage: "请选择支持的图片文件。",
      imageTooLarge: "图片大小不能超过 12 MB。",
      imageStorageError: "无法将背景图片保存到 Workbench 设置。",
    },
    backgroundBlurs: {
      none: "无",
      soft: "轻微",
      medium: "中等",
      strong: "强烈",
    },
    surfaces: {
      title: "组件表面",
      opacity: "表面不透明度",
      opacityValue: ({ opacity }: { opacity: number }, { number }: MessageFormatters) =>
        `${number(opacity)}%`,
      glassBlur: "玻璃模糊",
    },
    borders: {
      title: "边框",
      style: "边框样式",
      customColor: "使用自定义边框颜色",
      color: "组件边框颜色",
    },
    borderStyles: {
      default: "组件默认",
      solid: "实线",
      dashed: "虚线",
      dotted: "点线",
      none: "无边框",
    },
    corners: {
      title: "圆角",
      radius: "圆角样式",
    },
    cornerRadiusStyles: {
      default: "主题默认",
      square: "直角",
      subtle: "微圆",
      compact: "紧凑",
      soft: "柔和",
      rounded: "圆润",
      "extra-rounded": "大圆角",
    },
    code: {
      sectionTitle: "代码",
      title: "代码显示",
      description: "集中设置代码字体、字号、语法颜色和差异标记。",
      font: "代码字体",
    },
    preferences: {
      uiFontSize: "UI 字号",
      uiFontSizeDescription: "调整工作台界面使用的基准字号。",
      codeFontSize: "代码字体大小",
      codeFontSizeDescription: "调整代码和差异视图中使用的基础字号。",
      codeTheme: "代码主题",
      codeThemeDescription: "选择随工作台浅色或深色外观自动切换的 Shiki 配色。",
      codePreview: "代码预览",
      diffMarkers: "差异标记",
      diffMarkersDescription: "除颜色外，同时使用 +/- 标记显示更改。",
      fontSizeValue: ({ size }: { size: number }, { number }: MessageFormatters) =>
        `${number(size)} 像素`,
    },
    reset: "恢复默认",
  },

  userMessageIndex: {
    navigationLabel: "用户消息索引",
    jumpTo: ({ index }: { index: number }, { number }: MessageFormatters) =>
      `跳转到第 ${number(index)} 条用户消息`,
    nonTextPreview: "此消息包含附件或结构化内容。",
  },

  messagePresentation: {
    generating: "正在生成回答…",
    sourceFallback: "来源",
    attachmentReference: {
      image: ({ index }: { index: number }, { number }: MessageFormatters) =>
        `图片 ${number(index)}`,
      pdf: ({ index }: { index: number }, { number }: MessageFormatters) => `PDF ${number(index)}`,
    },
    elapsed: ({ duration }: { duration: string }) => `·${duration}·`,
    completedTurn: ({
      completedAt,
      duration,
      kind,
    }: {
      completedAt: string;
      duration: string;
      kind:
        | "completed"
        | "cancelled"
        | "aborted"
        | "length"
        | "network-error"
        | "api-error"
        | "provider-error";
    }) => {
      const durationLabel = duration ? ` · 耗时 ${duration}` : "";
      switch (kind) {
        case "cancelled":
          return `用户已在 ${completedAt} 停止生成${durationLabel}`;
        case "aborted":
          return `已在 ${completedAt} 中止${durationLabel}`;
        case "length":
          return `已在 ${completedAt} 停止 · 达到长度限制${durationLabel}`;
        case "network-error":
          return `已在 ${completedAt} 失败 · 网络连接错误${durationLabel}`;
        case "api-error":
          return `已在 ${completedAt} 失败 · API 错误${durationLabel}`;
        case "provider-error":
          return `已在 ${completedAt} 失败 · Provider 错误${durationLabel}`;
        default:
          return `已在 ${completedAt} 完成${durationLabel}`;
      }
    },
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
        edited: "已编辑",
        created: "已新增",
        searched: "搜索",
        used: "调用",
      },
      activeSteps: {
        thinking: "正在思考",
        read: "正在读取",
        ran: "正在运行",
        edited: "正在编辑",
        creating: "正在新增",
        searched: "正在搜索",
        used: "正在调用",
      },
      request: "请求",
      result: "结果",
      failed: "失败",
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
    forkConversation: "从此处分叉会话",
    forkConversationPending: "正在分叉会话…",
    forkConversationFailed: "分叉会话失败，请重试",
    regenerateResponse: "重新生成回答",
    retryAttachmentRequest: "重新识别附件并生成回答",
    timing: {
      details: "性能统计",
      total: "总时间",
      firstToken: "首 token",
      inputTokens: "输入",
      outputTokens: "输出",
      tokensPerSecond: "TPS",
      cacheHitRate: "平均缓存命中",
    },
  },
  messageQueue: {
    drag: "拖动调整顺序",
    steer: "调整方向",
    remove: "删除排队消息",
    more: "更多操作",
    edit: "编辑消息",
    moveUp: "上移",
    moveDown: "下移",
    saveEdit: "保存修改",
    cancelEdit: "取消修改",
    close: "关闭排队",
    enable: "启用队列模式",
    messageFallback: "排队附件",
  },

  workspaceBrowser: {
    title: "浏览器",
    newSession: "新建浏览器会话",
    navigateFailed: "浏览器无法前往该地址，请重试。",
    address: "浏览器地址",
    navigate: "前往",
    back: "后退",
    forward: "前进",
    reload: "刷新",
    viewportTitle: "共享浏览器会话",
    viewportDescription:
      "此表面连接到独立浏览器会话。接入浏览器后端后，可在这里显示共享实时页面、截图和 CDP 状态。",
    annotate: "批注浏览器元素",
  },
  workspaceArtifact: {
    title: "产物",
    missing: "此产物已不可用。",
    rendered: "渲染预览",
    source: "源代码",
    annotate: "批注产物",
  },
} as const;
