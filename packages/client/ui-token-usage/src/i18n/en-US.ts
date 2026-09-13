import type { MessageFormatters } from "@workbench/i18n/runtime";

export const messages = {
  extensions: {
    tokenUsage: {
      turns: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} ${count === 1 ? "turn" : "turns"}`,
      steps: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} ${count === 1 ? "step" : "steps"}`,
      llm: "LLM",
      toolCalls: "tool calls",
      averageFirstToken: "avg first token",
      tokensPerSecondUnit: "tok/s",
      averageCacheHit: "avg cache hit",
      input: "input",
      output: "output",
      tokenUnit: "tok",
      unavailable: "—",
      detailsTitle: "Conversation statistics",
      showDetails: "Show context and conversation statistics",
      description: "Current context usage and cumulative conversation statistics",
      currentContextTitle: "Current context",
      currentContextValue: ({ used, budget }: { used: string; budget: string }) =>
        `${used} / ${budget}`,
      contextUsed: "Context used",
      estimatedContextValue: ({ used, budget }: { used: string; budget: string }) =>
        `${used} / ${budget}`,
      estimatedTokenValue: ({ tokens }: { tokens: string }) => tokens,
      nearingCompaction:
        "Context is approaching the automatic compaction point. Pi will preserve recent work when it compacts.",
      modelInputBreakdown: "Model input composition",
      breakdownGroups: {
        instructions: "Instructions and context",
        tools: "Tool definitions",
        conversation: "Conversation content",
      },
      breakdownCategories: {
        "system-prompt": "System prompt",
        skills: "Skills",
        "context-files": "Context files and injected content",
        "builtin-tools": "Built-in tool schemas",
        "mcp-tools": "MCP tool schemas",
        "extension-tools": "Extension tool schemas",
        "user-input": "User input",
        "assistant-history": "Assistant history",
        "tool-results": "Tool results",
        other: "Other model input",
      },
      contextSettings: "Context settings",
      contextBudget: "Context limit",
      contextBudgetControlLabel: ({ mode, tokens }: { mode: string; tokens: string }) =>
        `Session context budget: ${mode}, ${tokens}`,
      customContextBudget: "Custom session context budget",
      applyContextBudget: "Apply",
      customContextBudgetInvalid: ({ tokens }: { tokens: string }) =>
        `Enter a whole number no greater than this model's ${tokens}-token capacity.`,
      contextBudgetModes: {
        inherit: "Follow model",
        auto: "Auto",
        maximum: "Maximum",
        custom: "Custom",
      },
      compactNow: "Compact now",
      viewContextTrace: "View Context Trace",
      contextTooSmall:
        "The current context is too short to compact. Continue the conversation and try again.",
      contextAlreadyCompacted:
        "The current context has already been compacted. Add more conversation before trying again.",
      contextCompactionCancelled: "Context compaction was cancelled.",
      contextActionBusy:
        "The conversation is running. Wait for the current operation and try again.",
      contextActionFailed: "The context action could not be completed. Try again.",
      cumulativeTitle: "Cumulative usage and performance",
    },
  },
} as const;
