"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE_PREFERENCES,
  parseAppearancePreferences,
  type AppearancePreferences,
} from "./appearance-preferences";
import {
  loadWorkbenchSettingsPreferences,
  toWorkbenchSettingsJsonObject,
  updateWorkbenchSettingsPreferences,
} from "@/runtime/pi/client/settings/workbench-settings-client";

type Listener = () => void;

let preferences: AppearancePreferences = DEFAULT_APPEARANCE_PREFERENCES;
let hydrationStarted = false;
let localRevision = 0;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

function replace(nextPreferences: AppearancePreferences): void {
  if (JSON.stringify(nextPreferences) === JSON.stringify(preferences)) {
    return;
  }

  preferences = Object.freeze({ ...nextPreferences });

  emit();
}

function removeLegacyPreference(): void {
  try {
    window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
  } catch {
    // The server document remains authoritative when browser cleanup is unavailable.
  }
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
    if (hydrationStarted || typeof window === "undefined") return;
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

    void loadWorkbenchSettingsPreferences()
      .then(async (stored) => {
        if (stored.appearance !== undefined) {
          if (localRevision === hydrationRevision) {
            replace(parseAppearancePreferences(JSON.stringify(stored.appearance)));
          }
          removeLegacyPreference();
          return;
        }
        if (serialized !== null && localRevision === hydrationRevision) {
          await updateWorkbenchSettingsPreferences({
            appearance: toWorkbenchSettingsJsonObject(legacyPreferences),
          });
          removeLegacyPreference();
        }
      })
      .catch(() => {
        // Keep the migrated browser value in memory while the host is unavailable.
      });
  },
  update(patch: Partial<AppearancePreferences>): void {
    localRevision += 1;
    const next = { ...preferences, ...patch };
    replace(next);
    void updateWorkbenchSettingsPreferences({
      appearance: toWorkbenchSettingsJsonObject(next),
    }).catch(() => undefined);
  },
  reset(): void {
    localRevision += 1;
    preferences = DEFAULT_APPEARANCE_PREFERENCES;
    removeLegacyPreference();
    void updateWorkbenchSettingsPreferences({ appearance: null }).catch(() => undefined);
    emit();
  },
  sync(serialized: string | null): void {
    replace(parseAppearancePreferences(serialized));
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
