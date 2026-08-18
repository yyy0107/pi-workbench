import type { MessageFormatters } from "@/i18n/types";

export const extensionsEnUS = {
  shared: {
    panelsCategory: "Panels",
  },
  localeSelector: {
    label: "Language",
    current: ({ language }: { language: string }) => `Language: ${language}`,
    switchTo: ({ language }: { language: string }) => `Switch language to ${language}`,
    english: "English",
    chinese: "Simplified Chinese",
  },
  codeEditor: {
    title: "Code editor",
    toggleTitle: "Toggle code editor",
    toggleDescription: "Open or close the right-side code editor panel",
    region: "Code editor",
    openedFiles: "Open files",
    closeFile: ({ name }: { name: string }) => `Close ${name}`,
    openFile: "Open file",
    filePath: "File path",
    noOpenFile: "No files open",
    chooseLocalFiles: "Choose local files",
    open: "Open",
    sourceCode: ({ name }: { name: string }) => `${name} source code`,
    emptyTitle: "Open a code file",
    emptyDescription: "Files are read only in this browser session and are never uploaded.",
    chooseFiles: "Choose files",
  },
  connectionStatus: {
    loading: "Loading",
    streaming: "Streaming",
    ready: "Ready",
    accessibleLabel: ({ status }: { status: string }) => `Assistant runtime: ${status}`,
    description: "Derived from the local assistant runtime",
  },
  modelSelector: {
    locked: "Model selection is locked while streaming",
    noModels: "No Pi models found.",
    loadFailed: "Could not load Pi models.",
    loadingMore: "Loading more models",
    contextWindow: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `${number(count, { notation: "compact", maximumFractionDigits: 1 })} context window`,
    low: "Low",
    medium: "Medium",
    high: "High",
    thinking: "Thinking",
  },
  messagePresentation: {
    generating: "Generating response…",
    sourceFallback: "Source",
    completedTurn: ({ completedAt, duration }: { completedAt: string; duration: string }) =>
      duration ? `Completed at ${completedAt} · Took ${duration}` : `Completed at ${completedAt}`,
    toolTimeline: {
      active: (
        { steps, files }: { steps: number; files: number },
        { number }: MessageFormatters,
      ) => {
        const stepLabel = steps === 1 ? "step" : "steps";
        const fileLabel = files === 1 ? "file" : "files";
        return files > 0
          ? `Working · ${number(steps)} ${stepLabel} · ${number(files)} ${fileLabel} changed`
          : `Working · ${number(steps)} ${stepLabel}`;
      },
      summary: (
        { steps, files }: { steps: number; files: number },
        { number }: MessageFormatters,
      ) => {
        const stepLabel = steps === 1 ? "step" : "steps";
        const fileLabel = files === 1 ? "file" : "files";
        return files > 0
          ? `${number(steps)} ${stepLabel} · ${number(files)} ${fileLabel} changed`
          : `${number(steps)} ${stepLabel}`;
      },
      steps: {
        thinking: "Thinking",
        read: "Read",
        ran: "Ran",
        edited: "Edited",
        searched: "Searched",
        used: "Used",
      },
      activeSteps: {
        thinking: "Thinking",
        read: "Reading",
        ran: "Running",
        edited: "Editing",
        searched: "Searching",
        used: "Using",
      },
      request: "Request",
      result: "Result",
    },
    reasoning: {
      active: "Thinking",
      complete: "Reasoned",
      completeWithDuration: ({ seconds }: { seconds: number }, { number }: MessageFormatters) =>
        `Reasoned for ${number(seconds)}s`,
      elapsed: ({ seconds }: { seconds: number }, { number }: MessageFormatters) =>
        `${number(seconds)}s`,
      step: "Reasoning",
    },
  },
  messageActions: {
    previousResponse: "Previous response",
    nextResponse: "Next response",
    editMessage: "Edit message",
    exportMarkdown: "Export as Markdown",
    regenerateResponse: "Regenerate response",
    goodResponse: "Good response",
    poorResponse: "Poor response",
    timing: {
      total: "total",
      firstToken: "first token",
      inputTokens: "input",
      outputTokens: "output",
      tokensPerSecond: "TPS",
      cacheHitRate: "cache hit",
    },
  },
  skills: {
    title: "Skills",
    add: "Add skills",
    toggle: "Toggle skills panel",
    summary: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `Skills ${number(count)}`,
    intro: "Enable the local capabilities available to this workbench preview.",
    search: "Search skills",
    noMatches: "No matching skills",
    broaderSearch: "Try a broader search term.",
    enabledCount: ({ enabled, total }: { enabled: number; total: number }) =>
      `${enabled} of ${total} enabled locally`,
    items: {
      research: {
        title: "Research",
        category: "Knowledge",
        description: "Find, compare, and synthesize trusted sources.",
      },
      codeReview: {
        title: "Code review",
        category: "Development",
        description: "Inspect changes for bugs and maintainability risks.",
      },
      documents: {
        title: "Documents",
        category: "Productivity",
        description: "Draft and refine structured documents.",
      },
      visualStudio: {
        title: "Visual studio",
        category: "Creative",
        description: "Plan and create polished visual assets.",
      },
      dataAnalysis: {
        title: "Data analysis",
        category: "Analysis",
        description: "Explore datasets and surface useful patterns.",
      },
      browser: {
        title: "Browser control",
        category: "Automation",
        description: "Navigate and inspect browser-based workflows.",
      },
    },
  },
  terminal: {
    title: "Terminal",
    toggleTitle: "Toggle terminal",
    toggleDescription: "Open or close the terminal panel",
    session: "Mock session · commands stay in this browser",
    clear: "Clear terminal",
    output: "Terminal output",
    input: "Mock terminal command",
    welcome: "Workbench Terminal · front-end preview",
    hint: 'Type "help" to see the available mock commands.',
    helpCommands: "Available: help, pwd, whoami, git status, pnpm dev, clear",
    helpSafety: "Commands are simulated locally and never reach a shell.",
    gitBranch: "On branch codex/workbench-v1",
    gitStatus: "Mock session — repository state is not inspected here.",
    devNotStarted: "Mock only — no process was started.",
    devHint: "Use the real project terminal to run pnpm commands.",
    unavailable: ({ command }: { command: string }) => `mock: command not available: ${command}`,
    unavailableHint: 'Try "help" for the supported preview commands.',
    tool: {
      running: "Running",
      complete: "Completed",
      failed: "Failed",
      waiting: "Waiting for approval",
      open: "Open terminal",
    },
  },
  tokenUsage: {
    accessibleLabel: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `Approximately ${number(count)} tokens in this thread`,
    display: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `≈ ${number(count)} tokens`,
    description: "Front-end estimate from visible thread content",
  },
  workspaceDirectory: {
    add: "Add local workspace",
    newThread: "New conversation",
    defaultName: "Select workspace",
    localPi: "Local Pi",
    selectTitle: "Select workspace",
    selectDescription: "Choose a server-side directory for the new conversation.",
    path: "Workspace path",
    pathPlaceholder: "/path/to/workspace or ~/workspace",
    open: "Open",
    parent: "Open parent directory",
    loading: "Loading directories…",
    empty: "No subdirectories",
    selectCurrent: "Use this workspace",
    selecting: "Selecting…",
    cancel: "Cancel",
    close: "Close workspace picker",
    browseError: "Unable to open this directory.",
    selectError: "Unable to select this workspace.",
  },
} as const;
