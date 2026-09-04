"use client";

import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";

import {
  useWorkbenchSettingsResource,
  type WorkbenchSettingsPort,
} from "@workbench/shell/settings";

export const ASK_USER_PREFERENCES_STORAGE_KEY = "workbench.ask-user.v1";

type Listener = () => void;

export interface AskUserPreferenceSnapshot {
  readonly enabled: boolean;
  readonly pendingEnabled?: boolean;
  readonly status: "loading" | "ready" | "saving";
  readonly saveFailed: boolean;
}

export interface AskUserPreferences {
  subscribe(listener: Listener): () => void;
  getSnapshot(): AskUserPreferenceSnapshot;
  getServerSnapshot(): AskUserPreferenceSnapshot;
  hydrate(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  dispose(): void;
}

const SERVER_SNAPSHOT: AskUserPreferenceSnapshot = Object.freeze({
  enabled: true,
  status: "loading",
  saveFailed: false,
});
const ASK_USER_PREFERENCES_RESOURCE = Symbol("workbench.ask-user-preferences");

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

export function createAskUserPreferences(settings: WorkbenchSettingsPort): AskUserPreferences {
  let snapshot: AskUserPreferenceSnapshot = SERVER_SNAPSHOT;
  let hydrationPromise: Promise<void> | undefined;
  let closed = false;
  const listeners = new Set<Listener>();

  const emit = (nextSnapshot: AskUserPreferenceSnapshot) => {
    if (closed) return;
    snapshot = nextSnapshot;
    for (const listener of listeners) listener();
  };
  const hydrate = (): Promise<void> => {
    if (closed || snapshot.status !== "loading") return Promise.resolve();
    hydrationPromise ??= (async () => {
      try {
        const preferences = await settings.load();
        if (closed) return;
        if (typeof preferences.askUserEnabled === "boolean") {
          if (closed) return;
          removeLegacyPreference();
          if (closed) return;
          emit({
            enabled: preferences.askUserEnabled,
            status: "ready",
            saveFailed: false,
          });
          return;
        }

        const legacyEnabled = readLegacyPreference();
        if (legacyEnabled !== undefined) {
          if (closed) return;
          await settings.update({ askUserEnabled: legacyEnabled });
          if (closed) return;
          removeLegacyPreference();
        }
        if (closed) return;
        emit({
          enabled: legacyEnabled ?? true,
          status: "ready",
          saveFailed: false,
        });
      } catch {
        if (closed) return;
        emit({ enabled: true, status: "ready", saveFailed: true });
      }
    })().finally(() => {
      hydrationPromise = undefined;
    });
    return hydrationPromise;
  };

  return Object.freeze({
    subscribe(listener: Listener): () => void {
      if (closed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot(): AskUserPreferenceSnapshot {
      return snapshot;
    },
    getServerSnapshot(): AskUserPreferenceSnapshot {
      return SERVER_SNAPSHOT;
    },
    hydrate,
    async setEnabled(enabled: boolean): Promise<void> {
      if (snapshot.status === "loading") await hydrate();
      if (closed) return;
      if (snapshot.status === "saving" || enabled === snapshot.enabled) return;

      const previousEnabled = snapshot.enabled;
      emit({
        enabled: previousEnabled,
        pendingEnabled: enabled,
        status: "saving",
        saveFailed: false,
      });
      try {
        await settings.update({ askUserEnabled: enabled });
        if (closed) return;
        removeLegacyPreference();
        if (closed) return;
        emit({ enabled, status: "ready", saveFailed: false });
      } catch (error) {
        if (closed) return;
        emit({ enabled: previousEnabled, status: "ready", saveFailed: true });
        throw error;
      }
    },
    dispose(): void {
      if (closed) return;
      closed = true;
      listeners.clear();
    },
  });
}

function useAskUserPreferencesStore(): AskUserPreferences {
  return useWorkbenchSettingsResource(ASK_USER_PREFERENCES_RESOURCE, createAskUserPreferences);
}

export function useAskUserPreferences(): AskUserPreferenceSnapshot {
  const store = useAskUserPreferencesStore();
  const current = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  useLayoutEffect(() => {
    void store.hydrate();
  }, [store]);
  return current;
}

export function useAskUserPreferencesController(): Readonly<{
  setEnabled(enabled: boolean): Promise<void>;
}> {
  const store = useAskUserPreferencesStore();
  return useMemo(() => ({ setEnabled: store.setEnabled }), [store]);
}
