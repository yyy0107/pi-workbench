export const desktopRendererEnUS = {
  metadata: {
    description: "A composable AI workbench built with assistant-ui.",
  },
  bootstrap: {
    title: "Pi Workbench",
    loading: "Connecting to the local Workbench Runtime…",
    failed: "The local Workbench Runtime could not be initialized.",
    retry: "Retry",
  },
  runtime: {
    category: "Desktop",
    restart: {
      title: "Restart local service",
      description: "Restart the local Workbench Runtime and reload the desktop workspace.",
    },
  },
} as const;
