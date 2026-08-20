import { create } from "zustand";

export type ModelId = string;
export type ReasoningEffort = string;

export interface DraftModelSelection {
  modelId?: ModelId;
  reasoningEffort?: ReasoningEffort;
}

interface ModelSelectorState {
  draftSelections: Readonly<Record<string, DraftModelSelection>>;
  setDraftSelection(threadId: string, selection: DraftModelSelection): void;
  clearDraftSelection(threadId: string): void;
}

export const useModelSelectorStore = create<ModelSelectorState>((set) => ({
  draftSelections: {},
  setDraftSelection: (threadId, selection) =>
    set((state) => ({
      draftSelections: {
        ...state.draftSelections,
        [threadId]: { ...state.draftSelections[threadId], ...selection },
      },
    })),
  clearDraftSelection: (threadId) =>
    set((state) => {
      if (!(threadId in state.draftSelections)) return state;
      const draftSelections = { ...state.draftSelections };
      delete draftSelections[threadId];
      return { draftSelections };
    }),
}));
