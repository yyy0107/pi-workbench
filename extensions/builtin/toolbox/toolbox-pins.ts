"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  loadWorkbenchSettingsPreferences,
  updateWorkbenchSettingsPreferences,
} from "@/runtime/pi/client/settings/workbench-settings-client";

const TOOLBOX_PINS_STORAGE_KEY = "pi-workbench:toolbox-pins:v1";
const EMPTY_PINS = Object.freeze([]) as readonly string[];

let hydrated = false;
let localRevision = 0;
let snapshot: readonly string[] = EMPTY_PINS;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function readStoredPins(): readonly string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(TOOLBOX_PINS_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return EMPTY_PINS;
    return Object.freeze([
      ...new Set(value.filter((item): item is string => typeof item === "string")),
    ]);
  } catch {
    return EMPTY_PINS;
  }
}

async function hydrate(): Promise<void> {
  if (hydrated || typeof localStorage === "undefined") return;
  hydrated = true;
  const legacyPins = readStoredPins();
  const hydrationRevision = localRevision;
  snapshot = legacyPins;
  emit();
  try {
    const preferences = await loadWorkbenchSettingsPreferences();
    if (preferences.toolboxPins && localRevision === hydrationRevision) {
      snapshot = Object.freeze([...preferences.toolboxPins]);
      localStorage.removeItem(TOOLBOX_PINS_STORAGE_KEY);
      emit();
    } else if (legacyPins.length > 0 && localRevision === hydrationRevision) {
      await updateWorkbenchSettingsPreferences({ toolboxPins: [...legacyPins] });
      localStorage.removeItem(TOOLBOX_PINS_STORAGE_KEY);
    }
  } catch {
    // Keep the legacy or in-memory pins while the host is unavailable.
  }
}

export function toggleToolboxPin(capabilityId: string): void {
  void hydrate();
  localRevision += 1;
  snapshot = snapshot.includes(capabilityId)
    ? Object.freeze(snapshot.filter((id) => id !== capabilityId))
    : Object.freeze([...snapshot, capabilityId]);
  void updateWorkbenchSettingsPreferences({ toolboxPins: [...snapshot] }).catch(() => undefined);
  emit();
}

export function useToolboxPins(): readonly string[] {
  const pins = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => EMPTY_PINS,
  );

  useEffect(() => {
    void hydrate();
  }, []);
  return pins;
}
