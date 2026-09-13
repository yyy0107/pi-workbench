import type { MessageFormatters } from "@workbench/i18n/runtime";

export const messages = {
  assistant: {
    model: {
      select: "Select model",
      model: "Model",
      search: "Search models…",
      empty: "No models found.",
      thinking: "Thinking",
      reasoningEffort: "Reasoning effort",
      fast: "Fast and efficient",
      balanced: "Balanced performance",
      capable: "Most capable",
      low: "Low",
      medium: "Medium",
      high: "High",
    },
  },
  extensions: {
    modelSelector: {
      manageModels: "Manage models",
      required: "Configure and select a model first",
      provider: "Provider",
      saving: "Saving the model for this session",
      noModels: "No Pi models found.",
      searchLabel: "Search models",
      searchPlaceholder: "Search models…",
      noSearchResults: "No matching models.",
      loadFailed: "Could not load Pi models.",
      selectFailed: "Could not change the model for this session.",
      currentUnavailable: "The current session model is unavailable. Choose another model.",
      unavailable: "Unavailable for new requests",
      loadingMore: "Loading more models",
      contextWindow: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count, { notation: "compact", maximumFractionDigits: 1 })} context window`,
      off: "Off",
      minimal: "Minimal",
      low: "Low",
      medium: "Medium",
      high: "High",
      xhigh: "Extra high",
      max: "Maximum",
      thinking: "Thinking",
    },
  },
} as const;
