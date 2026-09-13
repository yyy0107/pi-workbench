import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  extensions: {
    terminal: {
      panelsCategory: "面板",
      title: "终端",
      newTerminal: "新建终端",
      toggleTitle: "切换终端",
      toggleDescription: "新建终端或关闭当前终端工作区",
      clear: "清空终端显示",
      reconnect: "重新连接终端",
      output: "终端输出",
      status: {
        connecting: "正在连接 PTY…",
        connected: "已连接",
        connectedProcess: ({ process, pid }: { process: string; pid: number }) =>
          `${process} · PID ${pid}`,
        disconnected: "PTY 已断开 · 正在重连…",
        exited: ({ code }: { code: number }) => `进程已退出，退出码 ${code}`,
        error: "无法打开终端会话。",
      },
      tool: {
        view: "在终端中查看",
        activityComplete: "运行",
        activityRunning: "正在运行",
        collapseCommand: "收起命令",
        expandCommand: "展开命令",
        shellTitle: "Shell",
        statusRunning: "运行中",
        statusSuccess: "成功",
        interactionPossible: "可能正在等待输入",
        interactionActive: "终端输入进行中",
        userInputRequested: "正在等待你的输入",
        openTerminal: "打开终端",
      },
      transcript: {
        output: "会话终端输出",
        connecting: "正在连接命令终端…",
        reconnecting: "命令终端已断开 · 正在重连…",
        stopping: "正在停止命令…",
        connectionError: "命令终端连接失败",
        stop: "停止命令",
        running: "执行中 · 尚未收到进程退出通知",
        elapsed: ({ seconds }: { seconds: number }, { number }: MessageFormatters) =>
          `已运行 ${number(seconds)} 秒`,
        quiet: ({ seconds }: { seconds: number }, { number }: MessageFormatters) =>
          `已连续 ${number(seconds)} 秒没有输出`,
        processId: ({ pid }: { pid: number }, { number }: MessageFormatters) =>
          `PID ${number(pid, { useGrouping: false })}`,
        exited: ({ code }: { code: number }, { number }: MessageFormatters) =>
          `进程已退出 · 退出码 ${number(code)}`,
        awaitingResult: ({ code }: { code: number }, { number }: MessageFormatters) =>
          `进程已退出 · 退出码 ${number(code)} · 正在等待工具结果`,
        complete: "命令已完成",
        failed: "命令未完成",
        waiting: "命令正在等待操作",
        interactionPossible: "命令可能正在等待终端输入",
        interactionActive: "终端输入进行中",
        userInputRequested: "Agent 已将终端输入交给你",
        unavailable: "当前会话中没有这条命令的输出",
        waitingOutput: "正在等待输出…",
        noOutput: "没有输出",
      },
    },
  },
};
