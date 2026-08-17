import { create } from "zustand";

export type ModelId = string;
export type ReasoningEffort = "low" | "medium" | "high";

interface ModelSelectorState {
  modelId?: ModelId;
  reasoningEffort: ReasoningEffort;
  setModelId(modelId: ModelId): void;
  setReasoningEffort(reasoningEffort: ReasoningEffort): void;
}

export const useModelSelectorStore = create<ModelSelectorState>((set) => ({
  modelId: undefined,
  reasoningEffort: "medium",
  setModelId: (modelId) => set({ modelId }),
  setReasoningEffort: (reasoningEffort) => set({ reasoningEffort }),
}));
