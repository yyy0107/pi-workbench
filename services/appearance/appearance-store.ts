"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE_PREFERENCES,
  parseAppearancePreferences,
  type AppearancePreferences,
} from "./appearance-preferences";

type Listener = () => void;

let preferences: AppearancePreferences = DEFAULT_APPEARANCE_PREFERENCES;
let hydrated = false;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

function replace(nextPreferences: AppearancePreferences, persist: boolean): void {
  if (JSON.stringify(nextPreferences) === JSON.stringify(preferences)) {
    hydrated = true;
    return;
  }

  preferences = Object.freeze({ ...nextPreferences });
  hydrated = true;

  if (persist) {
    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // The live preference still applies when storage is unavailable.
    }
  }

  emit();
}

export const appearanceStore = Object.freeze({
  subscribe(listener: Listener): () => void {
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
    if (hydrated || typeof window === "undefined") return;

    let serialized: string | null = null;
    try {
      serialized = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    } catch {
      // Keep defaults when storage is unavailable.
    }

    replace(parseAppearancePreferences(serialized), false);
  },
  update(patch: Partial<AppearancePreferences>): void {
    replace({ ...preferences, ...patch }, true);
  },
  reset(): void {
    preferences = DEFAULT_APPEARANCE_PREFERENCES;
    hydrated = true;
    try {
      window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
    } catch {
      // The in-memory preference has still been reset.
    }
    emit();
  },
  sync(serialized: string | null): void {
    replace(parseAppearancePreferences(serialized), false);
  },
});

export function useAppearancePreferences(): AppearancePreferences {
  const snapshot = useSyncExternalStore(
    appearanceStore.subscribe,
    appearanceStore.getSnapshot,
    appearanceStore.getServerSnapshot,
  );

  useLayoutEffect(() => appearanceStore.hydrate(), []);

  return snapshot;
}
