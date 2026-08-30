import { create } from "zustand";

import {
  loadWorkbenchSettingsPreferences,
  updateWorkbenchSettingsPreferences,
} from "@/services/workbench-settings-service";

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

function removeLegacyRememberedSelection(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(MODEL_SELECTOR_STORAGE_KEY);
  } catch {
    // The server document remains authoritative when browser cleanup is unavailable.
  }
}

interface ModelSelectorState {
  draftSelections: Readonly<Record<string, DraftModelSelection>>;
  rememberedSelection?: RememberedModelSelection;
  setDraftSelection(threadId: string, selection: DraftModelSelection): void;
  clearDraftSelection(threadId: string): void;
  rememberSelection(selection: RememberedModelSelection): void;
}

const legacyRememberedSelection = loadRememberedSelection();
let rememberedSelectionRevision = 0;

export const useModelSelectorStore = create<ModelSelectorState>((set) => ({
  draftSelections: {},
  rememberedSelection: legacyRememberedSelection,
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
    rememberedSelectionRevision += 1;
    set({ rememberedSelection: selection });
    void updateWorkbenchSettingsPreferences({ modelSelector: selection })
      .then(removeLegacyRememberedSelection)
      .catch(() => undefined);
  },
}));

async function hydrateRememberedSelection(): Promise<void> {
  const hydrationRevision = rememberedSelectionRevision;
  try {
    const preferences = await loadWorkbenchSettingsPreferences();
    if (preferences.modelSelector) {
      if (rememberedSelectionRevision === hydrationRevision) {
        useModelSelectorStore.setState({ rememberedSelection: preferences.modelSelector });
      }
      removeLegacyRememberedSelection();
      return;
    }
    if (legacyRememberedSelection && rememberedSelectionRevision === hydrationRevision) {
      await updateWorkbenchSettingsPreferences({ modelSelector: legacyRememberedSelection });
      removeLegacyRememberedSelection();
    }
  } catch {
    // Keep the legacy or in-memory selection while the host is unavailable.
  }
}

if (typeof window !== "undefined") void hydrateRememberedSelection();
