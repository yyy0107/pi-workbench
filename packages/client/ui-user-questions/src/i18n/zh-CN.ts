import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  extensions: {
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
  },
};
