import { create } from "zustand";

export const MODEL_SELECTOR_STORAGE_KEY = "workbench.model-selector.v1";

export type ModelId = string;
export type ReasoningEffort = string;

export interface DraftModelSelection {
  modelId?: ModelId;
  reasoningEffort?: ReasoningEffort;
}

export interface RememberedModelSelection {
  modelId: ModelId;
  reasoningEffort?: ReasoningEffort;
}

export function parseRememberedModelSelection(
  serialized: string | null,
): RememberedModelSelection | undefined {
  if (!serialized) return undefined;
  try {
    const value = JSON.parse(serialized) as Record<string, unknown>;
    if (typeof value.modelId !== "string" || value.modelId.length === 0) return undefined;
    if (value.reasoningEffort !== undefined && typeof value.reasoningEffort !== "string") {
      return undefined;
    }
    return {
      modelId: value.modelId,
      ...(typeof value.reasoningEffort === "string"
        ? { reasoningEffort: value.reasoningEffort }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function loadRememberedSelection(): RememberedModelSelection | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return parseRememberedModelSelection(window.localStorage.getItem(MODEL_SELECTOR_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

function persistRememberedSelection(selection: RememberedModelSelection): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MODEL_SELECTOR_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Keep the in-memory default when browser storage is unavailable.
  }
}

interface ModelSelectorState {
  draftSelections: Readonly<Record<string, DraftModelSelection>>;
  rememberedSelection?: RememberedModelSelection;
  setDraftSelection(threadId: string, selection: DraftModelSelection): void;
  clearDraftSelection(threadId: string): void;
  rememberSelection(selection: RememberedModelSelection): void;
}

export const useModelSelectorStore = create<ModelSelectorState>((set) => ({
  draftSelections: {},
  rememberedSelection: loadRememberedSelection(),
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
  rememberSelection: (selection) => {
    persistRememberedSelection(selection);
    set({ rememberedSelection: selection });
  },
}));
