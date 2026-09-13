export const messages = {
  close: "关闭",
  document: { footnotes: "脚注", backToReference: "返回引用" },
  linkSafety: {
    title: "打开外部链接？",
    description: "你即将访问外部网站。",
    copy: "复制链接",
    copied: "链接已复制",
    copyFailed: "链接复制失败",
    open: "打开链接",
  },
  codeBlock: {
    mermaidDiagram: "Mermaid 图表",
    mermaidLoading: "正在渲染图表…",
    mermaidError: "Mermaid 图表渲染失败，请检查下方源码。",
  },
  preview: { copy: "复制 Markdown", copied: "已复制 Markdown", copyFailed: "Markdown 复制失败" },
} as const;
