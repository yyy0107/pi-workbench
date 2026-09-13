import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  extensions: {
    todoPanel: {
      title: "Tasks",
      updating: "Updating tasks",
      empty: "No tasks remaining.",
      progress: (
        { completed, total }: { completed: number; total: number },
        { number }: MessageFormatters,
      ) => `${number(completed)} / ${number(total)} completed`,
      owner: ({ owner }: { owner: string }) => `Owner: ${owner}`,
      blockedBy: ({ tasks }: { tasks: string }) => `Depends on: ${tasks}`,
    },
    settings: {
      conversation: {
        todoStatus: {
          pending: "Pending",
          in_progress: "In progress",
          completed: "Completed",
        },
      },
    },
  },
};
