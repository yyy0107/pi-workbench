"use client";

import { useEffect } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import {
  useWorkbenchSettingsResource,
  type WorkbenchSettingsPort,
  type WorkbenchSettingsPreferences,
} from "../settings";

type ConversationPreferences = Required<
  Pick<
    WorkbenchSettingsPreferences,
    | "runningMessageMode"
    | "showReasoning"
    | "groupParallelTools"
    | "enhancedSearch"
    | "askUserAutoContinue"
    | "retainAllModelIO"
    | "showTodos"
    | "groupExplorationTools"
    | "groupTerminalTools"
    | "groupFileChanges"
  >
>;

interface ConversationPreferenceState {
  preferences: ConversationPreferences;
  status: "loading" | "ready" | "saving" | "error";
  saveFailed: boolean;
  hydrate(): Promise<void>;
  update(patch: Partial<ConversationPreferences>): Promise<void>;
}

const DEFAULT_PREFERENCES: ConversationPreferences = {
  runningMessageMode: "queue",
  showReasoning: true,
  groupParallelTools: true,
  enhancedSearch: false,
  askUserAutoContinue: true,
  retainAllModelIO: false,
  showTodos: true,
  groupExplorationTools: true,
  groupTerminalTools: true,
  groupFileChanges: false,
};
const RESOURCE = Symbol("workbench.conversation-preferences");

export function createConversationPreferences(settings: WorkbenchSettingsPort) {
  let closed = false;
  let hydration: Promise<void> | undefined;
  const store = createStore<ConversationPreferenceState>((set, get) => ({
    preferences: DEFAULT_PREFERENCES,
    status: "loading",
    saveFailed: false,
    hydrate() {
      if (closed || get().status === "ready" || get().status === "saving") {
        return Promise.resolve();
      }
      hydration ??= (async () => {
        set({ status: "loading" });
        try {
          const stored = await settings.load();
          if (closed) return;
          set({
            preferences: {
              runningMessageMode: stored.runningMessageMode ?? "queue",
              showReasoning: stored.showReasoning ?? true,
              groupParallelTools: stored.groupParallelTools ?? true,
              enhancedSearch: stored.enhancedSearch ?? false,
              askUserAutoContinue: stored.askUserAutoContinue ?? true,
              retainAllModelIO: stored.retainAllModelIO ?? false,
              showTodos: stored.showTodos ?? true,
              groupExplorationTools: stored.groupExplorationTools ?? true,
              groupTerminalTools: stored.groupTerminalTools ?? true,
              groupFileChanges: stored.groupFileChanges ?? false,
            },
            status: "ready",
          });
        } catch {
          if (!closed) set({ status: "error" });
        }
      })().finally(() => {
        hydration = undefined;
      });
      return hydration;
    },
    async update(patch) {
      if (closed || get().status !== "ready") return;
      const previous = get().preferences;
      set({ preferences: { ...previous, ...patch }, status: "saving", saveFailed: false });
      try {
        await settings.update(patch);
        if (!closed) {
          set({ status: "ready" });
        }
      } catch {
        if (!closed) set({ preferences: previous, status: "ready", saveFailed: true });
      }
    },
  }));
  return Object.assign(store, {
    dispose: () => {
      closed = true;
    },
  });
}

export function useConversationPreferences<T>(
  selector: (state: ConversationPreferenceState) => T,
): T {
  const store = useWorkbenchSettingsResource(RESOURCE, createConversationPreferences);
  useEffect(() => {
    void store.getState().hydrate();
  }, [store]);
  return useStore(store, selector);
}
