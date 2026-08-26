"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

export const ASK_USER_PREFERENCES_STORAGE_KEY = "workbench.ask-user.v1";

type Listener = () => void;

let askUserEnabled = true;
let hydrated = false;
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

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(): void {
  try {
    window.localStorage.setItem(
      ASK_USER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ enabled: askUserEnabled }),
    );
  } catch {
    // Keep the current-page preference when browser storage is unavailable.
  }
}

export const askUserPreferences = Object.freeze({
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): boolean {
    return askUserEnabled;
  },
  getServerSnapshot(): boolean {
    return true;
  },
  hydrate(): void {
    if (hydrated || typeof window === "undefined") return;
    hydrated = true;
    try {
      askUserEnabled = parseAskUserEnabled(
        window.localStorage.getItem(ASK_USER_PREFERENCES_STORAGE_KEY),
      );
    } catch {
      askUserEnabled = true;
    }
    emit();
  },
  setEnabled(enabled: boolean): void {
    if (enabled === askUserEnabled) return;
    askUserEnabled = enabled;
    if (typeof window !== "undefined") persist();
    emit();
  },
});

export function useAskUserEnabled(): boolean {
  const enabled = useSyncExternalStore(
    askUserPreferences.subscribe,
    askUserPreferences.getSnapshot,
    askUserPreferences.getServerSnapshot,
  );

  useLayoutEffect(() => askUserPreferences.hydrate(), []);
  return enabled;
}
