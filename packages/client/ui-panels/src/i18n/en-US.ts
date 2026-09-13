export const panelsEnUS = {
  workbench: {
    panels: {
      closePanel: "Close panel",
      resize: ({ location }: { location: string }) => `Resize ${location} panel`,
      locations: {
        left: "left",
        right: "right",
        bottom: "bottom",
      },
      expandRight: "Expand right sidebar",
      collapseRight: "Collapse right sidebar",
      rightExtensions: "Right sidebar extensions",
      closeTab: ({ label }: { label: string }) => `Close ${label}`,
      addTab: "Add right sidebar tab",
      noTabs: "No more tabs available",
    },
  },
} as const;
