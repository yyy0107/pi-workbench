import type { MessageFormatters } from "@workbench/i18n/runtime";
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
      loadingHistory: "正在加载会话历史…",
      commandArguments: {
        customInstructions: "自定义指令",
      },
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
      commandResponses: {
        compactRunning: "正在压缩上下文…",
        compactSucceeded: "会话上下文已压缩。",
        compactFailed: "无法压缩会话上下文。",
        reloadRunning: "正在重新加载扩展、Skills、提示词和上下文文件…",
        reloadSucceeded: "已重新加载扩展、Skills、提示词和上下文文件。",
        reloadFailed: "无法重新加载扩展、Skills、提示词和上下文文件。",
        reloadConfiguration: {
          title: "重新加载后的配置",
          extensions: "扩展",
          skills: "Skills",
          prompts: "提示词",
          contextFiles: "上下文文件",
          none: "无",
        },
        commandRunning: ({ command }: { command: string }) => `${command} 正在执行…`,
        commandSucceeded: ({ command }: { command: string }) => `${command} 已完成。`,
        commandFailed: ({ command }: { command: string }) => `${command} 未能完成。`,
        failureReasons: {
          contextTooSmall: "当前上下文太短，没有可压缩的较早内容；继续对话后再试。",
          alreadyCompacted: "原因：当前上下文已经压缩，暂时没有新增内容需要处理。继续对话后再试。",
          cancelled: "原因：操作在完成前被取消。请确认没有其他会话操作正在中断它，然后重试。",
          modelUnavailable: "原因：当前会话没有可用模型。请选择并配置模型后重试。",
          authenticationFailed: "原因：当前模型的身份验证失败。请重新登录或检查 API Key 后重试。",
          quotaExhausted: "原因：模型服务额度不足或计费不可用。请检查账户额度后重试。",
          rateLimited: "原因：模型服务触发限流。请稍后重试。",
          networkError: "原因：无法连接模型服务。请检查网络和服务地址后重试。",
          timeout: "原因：模型服务未在限定时间内响应。请稍后重试。",
          providerUnavailable: "原因：模型服务当前不可用。请稍后重试或切换模型。",
          sessionDataInvalid:
            "原因：当前会话历史无法安全压缩。请新建会话，或修复已持久化的会话数据。",
          summaryGenerationFailed:
            "原因：模型未能生成有效的上下文摘要。请检查模型配置或切换模型后重试。",
          reloadFailed:
            "原因：扩展、Skill、提示词或上下文文件加载失败。请检查最近修改的资源后重试。",
          unknown: "原因：命令执行遇到未分类的运行时错误。请重试；如果持续失败，请查看服务端日志。",
        },
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
        }) =>
          previousModel ? `模型已从 ${previousModel} 切换为 ${model}` : `模型已切换为 ${model}`,
        contextCompacted: "会话上下文已压缩",
        contextCompactionReason: ({ reason }: { reason: string }) => {
          switch (reason) {
            case "manual":
              return "压缩原因：手动触发";
            case "threshold":
              return "压缩原因：上下文达到压缩阈值";
            case "overflow":
              return "压缩原因：运行时判定上下文溢出或输出截断";
            default:
              return "压缩原因：未记录";
          }
        },
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
        emptyPrompt: "发送前请输入消息，或附加图片。",
        sessionNotFound: "此会话已不可用。",
        invalidWorkingDirectory: "运行时工作目录不可用。",
        invalidWorkspace: "请先选择有效的工作区，再开始会话。",
        modelNotAvailable: "当前配置的提供方不支持此模型。",
        modelDoesNotSupportAttachments: "当前路由无法接收此附件。请移除附件或选择兼容的识别路由。",
        invalidAttachment: "无法发送此附件。请使用有效的 PNG、JPEG、GIF 或 WebP 文件。",
        attachmentTooLarge: "附件过大，无法发送。请选择较小的文件。",
        tooManyAttachments: "一次发送的附件过多。请移除部分文件后重试。",
        requestFailed: "运行时未能完成请求，请重试。",
        commandCompileFailed: "无法发送当前命令组合。请删除冲突或已不可用的命令 Token 后重试。",
        retry: "重试",
        retrying: "正在重试",
        continue: "继续",
        continuing: "正在继续",
        generationStopped: "生成已停止",
        generationInterrupted: "生成已中止",
        connectionFailed: "连接失败",
        requestFailedTitle: "请求失败",
        imageInputUnsupportedTitle: "当前模型不支持图片",
        imageInputUnsupported: "此消息已保留。请切换到支持图片输入的模型，然后重试本轮请求。",
        stoppedByUser: "用户已手动停止本次回答。",
        interrupted: "回答在完成前意外中止。",
        stoppedCanContinue: "本次回答已停止。继续将接着完成当前任务。",
        interruptedCanContinue: "中止点已保存。继续将从最近的安全位置接着完成当前任务。",
        continueFailed: "未能继续当前任务。请刷新会话后再试。",
        resumeRequiresConfirmation:
          "中止前有工具可能已改变外部状态。在确认工具结果前，无法自动继续。",
        resumeRequiresModelChange:
          "中止点已保存。请切换到有可用额度或权限的模型或 Provider 后继续。",
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
    actions: {
      edit: "编辑",
      copy: "复制",
      copied: "已复制",
      copyFailed: "复制失败",
      refresh: "重新生成",
    },
    markdown: { footnotes: "脚注", backToReference: "返回引用" },
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
    image: {
      zoom: "点击放大图片",
      closeZoom: "关闭图片预览",
      generating: "正在生成图片…",
      failed: "图片生成失败",
      stopped: "图片生成已停止",
      loadFailed: "图片加载失败",
      providerBlocked: "服务提供方阻止了此图片。",
      regenerate: "重新生成图片",
      download: "下载图片",
      copy: "复制图片",
      contentAlt: "图片内容",
    },
    file: {
      unnamed: "未命名文件",
    },
    tool: {
      used: "已使用工具",
      cancelled: "已取消工具",
      result: "结果：",
      error: "错误：",
      cancelledReason: "取消原因：",
      allow: "允许",
      alwaysAllow: "始终允许",
      deny: "拒绝",
      alwaysDeny: "始终拒绝",
      confirm: "确认",
      cancel: "取消",
      back: "返回",
      confirmOption: ({ label }: { label: string }) => `确认${label}？`,
      calls: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} 次工具调用`,
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
  chatContent: { userMessage: { showMore: "显示更多", showLess: "收起" } },
  extensions: {
    messagePresentation: {
      generating: "正在生成回答…",
      sourceFallback: "来源",
      attachmentReference: {
        image: ({ index }: { index: number }, { number }: MessageFormatters) =>
          `图片 ${number(index)}`,
        pdf: ({ index }: { index: number }, { number }: MessageFormatters) =>
          `PDF ${number(index)}`,
      },
      elapsed: ({ duration }: { duration: string }) => `·${duration}·`,
      continuedTurn: ({ continuedAt }: { continuedAt: string }) => `在 ${continuedAt} 继续`,
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
        activeLatest: ({ latest }: { latest: string }) => `正在工作 · ${latest}`,
        planningNextStep: "正在规划下一步",
        summary: (
          { steps, files }: { steps: number; files: number },
          { number }: MessageFormatters,
        ) =>
          files > 0
            ? `已完成 · ${number(steps)} 个步骤 · ${number(files)} 个文件已更改`
            : `已完成 · ${number(steps)} 个步骤`,
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
        recovering: "连接正在恢复",
        stalled: "仍在思考",
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
    userMessageIndex: {
      navigationLabel: "用户消息索引",
      jumpTo: ({ index }: { index: number }, { number }: MessageFormatters) =>
        `跳转到第 ${number(index)} 条用户消息`,
      nonTextPreview: "此消息包含附件或结构化内容。",
    },
    todoPanel: {
      title: "任务列表",
      updating: "正在更新任务",
      empty: "当前没有待办事项。",
      progress: (
        { completed, total }: { completed: number; total: number },
        { number }: MessageFormatters,
      ) => `已完成 ${number(completed)} / ${number(total)}`,
      owner: ({ owner }: { owner: string }) => `负责人：${owner}`,
      blockedBy: ({ tasks }: { tasks: string }) => `依赖任务：${tasks}`,
    },
    interactiveRequests: {
      questionTitle: "问题",
      questionDescription: "回答此请求后，会话才能继续。",
      approvalTitle: "需要工具授权",
      approvalDescription: "请在允许工具运行前检查此请求。",
      session: ({ sessionId }: { sessionId: string }) => `会话 ${sessionId}`,
      pending: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} 个待处理请求`,
      answerLabel: ({ question }: { question: string }) => `${question}的回答`,
      answerPlaceholder: "回复…",
      customAnswerLabel: "其他答案",
      customAnswerPlaceholder: "或输入你自己的回答",
      required: "必填",
      yes: "是",
      no: "否",
      tool: "工具",
      callId: "调用 ID",
      reason: "原因",
      submit: "提交回答",
      send: "发送",
      submitAndContinue: "提交并继续",
      nextQuestion: "下一步",
      skip: "跳过",
      timeoutCountdown: ({ seconds }: { seconds: number }, { number }: MessageFormatters) =>
        `${number(seconds)} 秒后自动跳过本题`,
      submitting: "正在发送…",
      cancel: "取消请求",
      close: "关闭授权请求",
      allowOnce: "允许一次",
      reject: "拒绝",
      selectedCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `已选择 ${number(count)} 项`,
      recommended: "推荐",
      navigator: {
        title: "问题列表",
        position: (
          { current, total }: { current: number; total: number },
          { number }: MessageFormatters,
        ) => `${number(current)} / ${number(total)}`,
        index: ({ index }: { index: number }, { number }: MessageFormatters) => number(index),
        open: (
          { current, total }: { current: number; total: number },
          { number }: MessageFormatters,
        ) => `打开问题列表，当前是第 ${number(current)} 题，共 ${number(total)} 题`,
        previous: "上一题",
        next: "下一题",
        answered: "已回答",
        unanswered: "未回答",
      },
      validation: {
        missingRequired: "请回答所有必填问题后再提交。",
      },
      askUserTool: {
        activityGenerating: "正在生成问题",
        activityRunning: "正在询问用户",
        activityComplete: "已询问用户",
        questionCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `${number(count)} 个问题`,
        history: "问答记录",
        waiting: "正在等待用户回答",
        unanswered: "未提交回答",
        cancelledAnswer: "取消前未提交回答",
        cancelled: "请求已取消，没有提交回答。",
        interrupted: "请求未完成，没有提交回答。",
        disabled: "Ask User 已关闭，因此没有向用户提问。",
      },
      errors: {
        badResponse: "主机拒绝了此回答，请检查各字段后重试。",
        notPending: "此请求已不再等待处理。",
        network: "无法发送回答，请检查连接后重试。",
      },
    },
    sideChat: {
      title: "临时侧聊",
      indexedTitle: ({ sequence }: { sequence: number }, { number }: MessageFormatters) =>
        `临时侧聊 (${number(sequence)})`,
      open: "打开临时侧聊",
      creating: "正在创建临时侧聊…",
      promote: "保留为会话",
      promoteDescription: "将这个临时侧聊保存为普通会话。",
      promoting: "正在保存…",
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
    settings: {
      conversation: {
        explorationGroup: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `探索 · ${number(count)}`,
        terminalGroup: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `运行了 ${number(count)} 个命令`,
        changesGroup: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `更改 · ${number(count)}`,
        todoStatus: { pending: "待处理", in_progress: "进行中", completed: "已完成" },
      },
    },
  },
};
