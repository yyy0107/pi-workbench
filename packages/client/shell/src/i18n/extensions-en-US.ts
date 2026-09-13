import type { MessageFormatters } from "@workbench/i18n/runtime";

export const extensionsEnUS = {
  generativeUi: {
    name: "Generative UI",
    description:
      "Renders allowlisted generative UI component trees embedded in assistant messages.",
    placement: {
      surface: "Individual text or generative UI part inside an assistant message",
      description:
        "When a message part contains a complete allowlisted component tree, this renderer replaces only that leaf part; unmatched content keeps its original message renderer.",
    },
    preview: {
      title: "Structured response",
      caption: "Assistant message component",
      body: "The preview uses the same component library, theme tokens, and scoped styles as the rendered message.",
      action: "Preview",
    },
  },
  shared: {
    capabilityUnavailable: "This runtime does not support this feature.",
    copyMarkdown: "Copy Markdown",
    markdownCopied: "Markdown copied",
    markdownCopyFailed: "Couldn't copy Markdown",
    panelsCategory: "Panels",
    fileTree: {
      tree: "Workspace file tree",
      empty: "This workspace folder is empty.",
      noMatches: "No files match this filter.",
      loading: "Loading workspace files…",
      loadError: "The workspace files could not be loaded.",
      retry: "Retry",
      loadingDirectory: ({ name }: { name: string }) => `Loading ${name}…`,
      loadDirectoryError: ({ name }: { name: string }) => `${name} could not be loaded.`,
      retryDirectory: ({ name }: { name: string }) => `Retry loading ${name}`,
      emptyDirectory: ({ name }: { name: string }) => `${name} is empty.`,
      openError: ({ name }: { name: string }) => `${name} could not be opened.`,
      truncated: "Some entries are not shown because this folder is very large.",
    },
    reviewableDiff: {
      discard: "Discard",
      discardHunk: ({ range }: { range: string }) => `Discard hunk ${range}`,
      keep: "Keep",
      keepAll: "Keep all",
      keepHunk: ({ range }: { range: string }) => `Keep hunk ${range}`,
      kept: "kept",
      discarded: "discarded",
      remaining: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} left to review`,
      allReviewed: "All reviewed",
    },
  },
} as const;
