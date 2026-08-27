"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

import {
  loadWorkbenchSettingsPreferences,
  updateWorkbenchSettingsPreferences,
} from "@/runtime/pi/client/settings/workbench-settings-client";

export const ASK_USER_PREFERENCES_STORAGE_KEY = "workbench.ask-user.v1";

type Listener = () => void;

export interface AskUserPreferenceSnapshot {
  readonly enabled: boolean;
  readonly pendingEnabled?: boolean;
  readonly status: "loading" | "ready" | "saving";
  readonly saveFailed: boolean;
}

const SERVER_SNAPSHOT: AskUserPreferenceSnapshot = Object.freeze({
  enabled: true,
  status: "loading",
  saveFailed: false,
});

let snapshot: AskUserPreferenceSnapshot = SERVER_SNAPSHOT;
let hydrationPromise: Promise<void> | undefined;
const listeners = new Set<Listener>();

export function parseAskUserEnabled(serialized: string | null): boolean {
  if (!serialized) return true;
  try {
    const value: unknown = JSON.parse(serialized);
    return typeof value === "object" && value !== null && "enabled" in value
      ? (value as { enabled?: unknown }).enabled !== false
      : true;
  } catch {
    return true;
  }
}

function emit(nextSnapshot: AskUserPreferenceSnapshot): void {
  snapshot = nextSnapshot;
  for (const listener of listeners) listener();
}

function readLegacyPreference(): boolean | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const serialized = window.localStorage.getItem(ASK_USER_PREFERENCES_STORAGE_KEY);
    return serialized === null ? undefined : parseAskUserEnabled(serialized);
  } catch {
    return undefined;
  }
}

function removeLegacyPreference(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ASK_USER_PREFERENCES_STORAGE_KEY);
  } catch {
    // The server-backed preference remains authoritative when browser storage is unavailable.
  }
}

export const askUserPreferences = Object.freeze({
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): AskUserPreferenceSnapshot {
    return snapshot;
  },
  getServerSnapshot(): AskUserPreferenceSnapshot {
    return SERVER_SNAPSHOT;
  },
  hydrate(): Promise<void> {
    if (snapshot.status !== "loading") return Promise.resolve();
    hydrationPromise ??= (async () => {
      try {
        const preferences = await loadWorkbenchSettingsPreferences();
        if (typeof preferences.askUserEnabled === "boolean") {
          removeLegacyPreference();
          emit({
            enabled: preferences.askUserEnabled,
            status: "ready",
            saveFailed: false,
          });
          return;
        }

        const legacyEnabled = readLegacyPreference();
        if (legacyEnabled !== undefined) {
          await updateWorkbenchSettingsPreferences({ askUserEnabled: legacyEnabled });
          removeLegacyPreference();
        }
        emit({
          enabled: legacyEnabled ?? true,
          status: "ready",
          saveFailed: false,
        });
      } catch {
        emit({ enabled: true, status: "ready", saveFailed: true });
      }
    })().finally(() => {
      hydrationPromise = undefined;
    });
    return hydrationPromise;
  },
  async setEnabled(enabled: boolean): Promise<void> {
    if (snapshot.status === "loading") await this.hydrate();
    if (snapshot.status === "saving" || enabled === snapshot.enabled) return;

    const previousEnabled = snapshot.enabled;
    emit({
      enabled: previousEnabled,
      pendingEnabled: enabled,
      status: "saving",
      saveFailed: false,
    });
    try {
      await updateWorkbenchSettingsPreferences({ askUserEnabled: enabled });
      removeLegacyPreference();
      emit({ enabled, status: "ready", saveFailed: false });
    } catch (error) {
      emit({ enabled: previousEnabled, status: "ready", saveFailed: true });
      throw error;
    }
  },
});

export function useAskUserPreferences(): AskUserPreferenceSnapshot {
  const current = useSyncExternalStore(
    askUserPreferences.subscribe,
    askUserPreferences.getSnapshot,
    askUserPreferences.getServerSnapshot,
  );

  useLayoutEffect(() => {
    void askUserPreferences.hydrate();
  }, []);
  return current;
}
