export const panelsZhCN = {
  workbench: {
    panels: {
      closePanel: "关闭面板",
      resize: ({ location }: { location: string }) => `调整${location}面板大小`,
      locations: {
        left: "左侧",
        right: "右侧",
        bottom: "底部",
      },
      expandRight: "展开右侧栏",
      collapseRight: "收起右侧栏",
      rightExtensions: "右侧栏扩展",
      closeTab: ({ label }: { label: string }) => `关闭 ${label}`,
      addTab: "添加右侧栏标签",
      noTabs: "暂无可添加的标签",
    },
  },
} as const;
