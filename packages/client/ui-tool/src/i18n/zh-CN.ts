import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  assistant: {
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
  },
  extensions: {
    messagePresentation: {
      elapsed: ({ duration }: { duration: string }) => `·${duration}·`,
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
    settings: {
      conversation: {
        explorationGroup: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `探索 · ${number(count)}`,
        terminalGroup: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `运行了 ${number(count)} 个命令`,
        changesGroup: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `更改 · ${number(count)}`,
      },
    },
  },
};
