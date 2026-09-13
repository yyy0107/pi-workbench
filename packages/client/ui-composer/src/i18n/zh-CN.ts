export const messages = {
  workbench: {
    chat: {
      composer: {
        placeholder: "描述你想完成的任务，或粘贴需要处理的内容…",
        runningPlaceholder: "按 Enter 加入队列，按 Ctrl/Cmd+Enter 调整当前运行的方向…",
        runningSteerPlaceholder: "按 Enter 调整当前运行的方向，按 Ctrl/Cmd+Enter 加入队列…",
        steerMessage: "调整方向",
        selectWorkspacePlaceholder: "请先选择工作区，再开始会话…",
        messageInput: "消息输入框",
        addMenu: {
          open: "添加内容",
          attachment: "添加附件",
          context: "使用 @ 添加上下文",
          capability: "使用 / 选择能力",
        },
        contextMentions: {
          suggestions: "上下文建议",
          conversations: "会话",
          workspaceFiles: "工作区文件",
          untitledConversation: "未命名会话",
          loading: "正在加载工作区文件…",
          empty: "未找到上下文",
          loadError: "无法加载工作区文件",
        },
        stopVoiceInput: "停止语音输入",
        voiceInput: "语音输入",
        stopGenerating: "停止生成",
        sendMessage: "发送消息",
        queueFollowUp: "加入后续队列",
        dismissError: "关闭提示",
      },
    },
  },
  assistant: {
    composer: {
      placeholder: "发送消息…",
      messageInput: "消息输入框",
      addAttachment: "添加附件",
      removeAttachment: ({ name }: { name: string }) => `移除 ${name}`,
      stopVoiceInput: "停止语音输入",
      voiceInput: "语音输入",
      startVoiceInput: "开始语音输入",
      transcribing: "正在转写",
      stopGenerating: "停止生成",
      sendMessage: "发送消息",
    },
  },
  composer: {
    errors: {
      modelDoesNotSupportAttachments: "当前路由无法接收此附件。请移除附件或选择兼容的识别路由。",
      attachmentTooLarge: "附件过大，无法发送。请选择较小的文件。",
      tooManyAttachments: "一次发送的附件过多。请移除部分文件后重试。",
      invalidAttachment: "无法发送此附件。请使用有效的 PNG、JPEG、GIF 或 WebP 文件。",
      queueSendFailedRestored: "消息排队失败，草稿已恢复，你可以再次尝试发送。",
      commandCompileFailed: "无法发送当前命令组合。请删除冲突或已不可用的命令 Token 后重试。",
    },
  },
};
