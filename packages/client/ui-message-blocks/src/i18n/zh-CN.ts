export const messages = {
  workbench: {
    chat: {
      commandArguments: {
        customInstructions: "自定义指令",
      },
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
      },
      errors: {
        retry: "重试",
        retrying: "正在重试",
        requestFailedTitle: "请求失败",
        unknownFailure: "本次回答未能完成。",
      },
    },
  },
  assistant: {
    actions: {
      edit: "编辑",
      copy: "复制",
      copied: "已复制",
      copyFailed: "复制失败",
      refresh: "重新生成",
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
  },
  chatContent: {
    userMessage: {
      showMore: "显示更多",
      showLess: "收起",
    },
  },
};
