import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  workbench: {
    chat: {
      actions: {
        copyMessage: "复制消息",
        copyResponse: "复制回答",
      },
      sourceFallback: "来源",
      generating: "正在生成回答…",
      steering: {
        waitingToInsert: "正在等待插入…",
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
        modelDoesNotSupportAttachments: "当前路由无法接收此附件。请移除附件或选择兼容的识别路由。",
        invalidAttachment: "无法发送此附件。请使用有效的 PNG、JPEG、GIF 或 WebP 文件。",
        attachmentTooLarge: "附件过大，无法发送。请选择较小的文件。",
        tooManyAttachments: "一次发送的附件过多。请移除部分文件后重试。",
        commandCompileFailed: "无法发送当前命令组合。请删除冲突或已不可用的命令 Token 后重试。",
        continue: "继续",
        continuing: "正在继续",
        generationStopped: "生成已停止",
        generationInterrupted: "生成已中止",
        connectionFailed: "连接失败",
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
      },
    },
  },
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
    },
  },
};
