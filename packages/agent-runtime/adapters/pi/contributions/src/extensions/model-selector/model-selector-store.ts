"use client";

import { useEffect } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

import {
  useWorkbenchSettingsResource,
  type WorkbenchSettingsPort,
} from "@workbench/shell/settings";

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

export interface ModelSelectorState {
  draftSelections: Readonly<Record<string, DraftModelSelection>>;
  rememberedSelection?: RememberedModelSelection;
  setDraftSelection(threadId: string, selection: DraftModelSelection): void;
  clearDraftSelection(threadId: string): void;
  rememberSelection(selection: RememberedModelSelection): void;
  hydrate(): Promise<void>;
}

export type ModelSelectorStore = StoreApi<ModelSelectorState> & Readonly<{ dispose(): void }>;

const MODEL_SELECTOR_STORE_RESOURCE = Symbol("workbench.model-selector-store");

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

export function createModelSelectorStore(settings: WorkbenchSettingsPort): ModelSelectorStore {
  const legacyRememberedSelection = loadRememberedSelection();
  let rememberedSelectionRevision = 0;
  let hydrated = false;
  let hydrationPromise: Promise<void> | undefined;
  let closed = false;
  let store: StoreApi<ModelSelectorState>;
  const unsubscribeListeners = new Set<() => void>();

  const hydrate = (): Promise<void> => {
    if (closed || hydrated) return Promise.resolve();
    if (hydrationPromise) return hydrationPromise;
    const hydrationRevision = rememberedSelectionRevision;
    hydrationPromise = settings
      .load()
      .then(async (preferences) => {
        if (closed) return;
        if (preferences.modelSelector) {
          if (!closed && rememberedSelectionRevision === hydrationRevision) {
            store.setState({
              draftSelections: {},
              rememberedSelection: preferences.modelSelector,
            });
          }
          if (closed) return;
          removeLegacyRememberedSelection();
          if (closed) return;
          hydrated = true;
          return;
        }
        if (legacyRememberedSelection && rememberedSelectionRevision === hydrationRevision) {
          if (closed) return;
          await settings.update({ modelSelector: legacyRememberedSelection });
          if (closed) return;
          removeLegacyRememberedSelection();
        }
        if (closed) return;
        hydrated = true;
      })
      .catch(() => {
        // Keep the legacy or in-memory selection while the host is unavailable.
      })
      .finally(() => {
        hydrationPromise = undefined;
      });
    return hydrationPromise;
  };

  store = createStore<ModelSelectorState>((set) => ({
    draftSelections: {},
    rememberedSelection: legacyRememberedSelection,
    setDraftSelection: (threadId, selection) => {
      if (closed) return;
      set((state) => ({
        draftSelections: {
          ...state.draftSelections,
          [threadId]: { ...state.draftSelections[threadId], ...selection },
        },
      }));
    },
    clearDraftSelection: (threadId) => {
      if (closed) return;
      set((state) => {
        if (!(threadId in state.draftSelections)) return state;
        const draftSelections = { ...state.draftSelections };
        delete draftSelections[threadId];
        return { draftSelections };
      });
    },
    rememberSelection: (selection) => {
      if (closed) return;
      rememberedSelectionRevision += 1;
      set({ rememberedSelection: selection });
      void settings
        .update({ modelSelector: selection })
        .then(() => {
          if (!closed) removeLegacyRememberedSelection();
        })
        .catch(() => undefined);
    },
    hydrate,
  }));
  const subscribeNative = store.subscribe;
  const subscribe: StoreApi<ModelSelectorState>["subscribe"] = (listener) => {
    if (closed) return () => undefined;
    const unsubscribe = subscribeNative(listener);
    unsubscribeListeners.add(unsubscribe);
    return () => {
      unsubscribeListeners.delete(unsubscribe);
      unsubscribe();
    };
  };

  return Object.assign(store, {
    subscribe,
    dispose(): void {
      if (closed) return;
      closed = true;
      for (const unsubscribe of unsubscribeListeners) unsubscribe();
      unsubscribeListeners.clear();
    },
  });
}

function useInstalledModelSelectorStore(): ModelSelectorStore {
  return useWorkbenchSettingsResource(MODEL_SELECTOR_STORE_RESOURCE, createModelSelectorStore);
}

export function useModelSelectorStore<T>(selector: (state: ModelSelectorState) => T): T {
  return useStore(useInstalledModelSelectorStore(), selector);
}

export function useHydrateModelSelectorStore(): void {
  const hydrate = useModelSelectorStore((state) => state.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
}
