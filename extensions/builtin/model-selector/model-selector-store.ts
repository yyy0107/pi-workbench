import { create } from "zustand";

export const MODEL_OPTIONS = [
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    keywords: ["openai", "fast"],
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    keywords: ["openai", "balanced"],
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    keywords: ["openai", "reasoning"],
    efforts: true,
  },
] as const;

export type ModelId = (typeof MODEL_OPTIONS)[number]["id"];
export type ReasoningEffort = "low" | "medium" | "high";

interface ModelSelectorState {
  modelId: ModelId;
  reasoningEffort: ReasoningEffort;
  setModelId(modelId: ModelId): void;
  setReasoningEffort(reasoningEffort: ReasoningEffort): void;
}

export const useModelSelectorStore = create<ModelSelectorState>((set) => ({
  modelId: MODEL_OPTIONS[0].id,
  reasoningEffort: "medium",
  setModelId: (modelId) => set({ modelId }),
  setReasoningEffort: (reasoningEffort) => set({ reasoningEffort }),
}));
