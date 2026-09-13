export const messages = {
  close: "Close",
  document: { footnotes: "Footnotes", backToReference: "Back to reference" },
  linkSafety: {
    title: "Open external link?",
    description: "You're about to visit an external website.",
    copy: "Copy link",
    copied: "Link copied",
    copyFailed: "Couldn't copy link",
    open: "Open link",
  },
  codeBlock: {
    mermaidDiagram: "Mermaid diagram",
    mermaidLoading: "Rendering diagram…",
    mermaidError: "Couldn't render the Mermaid diagram. Check the source below.",
  },
  preview: {
    copy: "Copy Markdown",
    copied: "Markdown copied",
    copyFailed: "Couldn't copy Markdown",
  },
} as const;
