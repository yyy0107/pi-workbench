import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  extensions: {
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
    settings: {
      conversation: {
        todoStatus: {
          pending: "待处理",
          in_progress: "进行中",
          completed: "已完成",
        },
      },
    },
  },
};
