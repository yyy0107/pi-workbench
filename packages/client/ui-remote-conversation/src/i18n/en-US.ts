import type { MessageFormatters } from "@workbench/i18n/runtime";

export const messages = {
  remoteConversation: {
    empty: "No messages yet.",
    loadOlder: "Load earlier messages",
    loading: "Loading conversation…",
    loadError: "Could not load this conversation.",
    toolRunning: "Running",
    toolCompleted: "Completed",
    toolFailed: "Failed",
    toolInput: "Input",
    toolOutput: "Raw output",
    toolTruncated: "This tool transcript exceeded the remote limit and was truncated.",
    messageTruncated: "This message exceeded the remote limit and was truncated.",
    activityRunning: "Running",
    activityCompleted: "Completed",
    activityFailed: "Failed",
    stopped: "Run stopped",
    failed: "Run failed",
    assistantWorking: "Working…",
    contextComposed: "Context composed",
    composingContext: "Composing context",
    systemPromptInjected: "System prompt injected",
    toolsInjected: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `${number(count)} tools injected`,
    extensionsLoaded: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `${number(count)} extensions loaded`,
    contextDetails: "Details",
  },
} as const;
