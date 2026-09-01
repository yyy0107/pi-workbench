"use client";

import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";

import {
  toWorkbenchSettingsJsonObject,
  useWorkbenchSettingsResource,
  type WorkbenchSettingsPort,
} from "../settings";

import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE_PREFERENCES,
  parseAppearancePreferences,
  type AppearancePreferences,
} from "./appearance-preferences";

type Listener = () => void;

export interface AppearanceStore {
  subscribe(listener: Listener): () => void;
  getSnapshot(): AppearancePreferences;
  getServerSnapshot(): AppearancePreferences;
  hydrate(): void;
  update(patch: Partial<AppearancePreferences>): void;
  reset(): void;
  sync(serialized: string | null): void;
  dispose(): void;
}

const APPEARANCE_STORE_RESOURCE = Symbol("workbench.appearance-store");

function removeLegacyPreference(): void {
  try {
    window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
  } catch {
    // The server document remains authoritative when browser cleanup is unavailable.
  }
}

export function createAppearanceStore(settings: WorkbenchSettingsPort): AppearanceStore {
  let preferences: AppearancePreferences = DEFAULT_APPEARANCE_PREFERENCES;
  let hydrationStarted = false;
  let localRevision = 0;
  let closed = false;
  const listeners = new Set<Listener>();

  const emit = () => {
    if (closed) return;
    for (const listener of listeners) listener();
  };
  const replace = (nextPreferences: AppearancePreferences) => {
    if (closed) return;
    if (JSON.stringify(nextPreferences) === JSON.stringify(preferences)) return;
    preferences = Object.freeze({ ...nextPreferences });
    emit();
  };

  return Object.freeze({
    subscribe(listener: Listener): () => void {
      if (closed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot(): AppearancePreferences {
      return preferences;
    },
    getServerSnapshot(): AppearancePreferences {
      return DEFAULT_APPEARANCE_PREFERENCES;
    },
    hydrate(): void {
      if (closed || hydrationStarted || typeof window === "undefined") return;
      hydrationStarted = true;

      let serialized: string | null = null;
      try {
        serialized = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
      } catch {
        // Keep defaults when storage is unavailable.
      }

      const legacyPreferences = parseAppearancePreferences(serialized);
      const hydrationRevision = localRevision;
      replace(legacyPreferences);

      void settings
        .load()
        .then(async (stored) => {
          if (closed) return;
          if (stored.appearance !== undefined) {
            if (localRevision === hydrationRevision) {
              replace(parseAppearancePreferences(JSON.stringify(stored.appearance)));
            }
            if (closed) return;
            removeLegacyPreference();
            return;
          }
          if (serialized !== null && localRevision === hydrationRevision) {
            if (closed) return;
            await settings.update({
              appearance: toWorkbenchSettingsJsonObject(legacyPreferences),
            });
            if (closed) return;
            removeLegacyPreference();
          }
        })
        .catch(() => {
          // Keep the migrated browser value in memory while the host is unavailable.
        });
    },
    update(patch: Partial<AppearancePreferences>): void {
      if (closed) return;
      localRevision += 1;
      const next = { ...preferences, ...patch };
      replace(next);
      void settings
        .update({
          appearance: toWorkbenchSettingsJsonObject(next),
        })
        .catch(() => undefined);
    },
    reset(): void {
      if (closed) return;
      localRevision += 1;
      preferences = DEFAULT_APPEARANCE_PREFERENCES;
      removeLegacyPreference();
      void settings.update({ appearance: null }).catch(() => undefined);
      emit();
    },
    sync(serialized: string | null): void {
      if (closed) return;
      replace(parseAppearancePreferences(serialized));
    },
    dispose(): void {
      if (closed) return;
      closed = true;
      listeners.clear();
    },
  });
}

function useAppearanceStore(): AppearanceStore {
  return useWorkbenchSettingsResource(APPEARANCE_STORE_RESOURCE, createAppearanceStore);
}

export function useAppearancePreferences(): AppearancePreferences {
  const store = useAppearanceStore();
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  useLayoutEffect(() => store.hydrate(), [store]);
  return snapshot;
}

export function useAppearanceController(): Readonly<{
  update(patch: Partial<AppearancePreferences>): void;
  reset(): void;
}> {
  const store = useAppearanceStore();
  return useMemo(
    () => ({
      update: store.update,
      reset: store.reset,
    }),
    [store],
  );
}
