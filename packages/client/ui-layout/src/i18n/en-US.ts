export const layoutEnUS = {
  workbench: {
    shell: {
      currentWorkspace: ({ name }: { name: string }) => `Current workspace: ${name}`,
      mainViewBreadcrumbs: "Current page",
      workbench: "Workbench",
    },
  },
} as const;
