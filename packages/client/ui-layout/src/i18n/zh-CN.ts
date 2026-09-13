export const layoutZhCN = {
  workbench: {
    shell: {
      currentWorkspace: ({ name }: { name: string }) => `当前工作区：${name}`,
      mainViewBreadcrumbs: "当前页面",
      workbench: "Workbench",
    },
  },
} as const;
