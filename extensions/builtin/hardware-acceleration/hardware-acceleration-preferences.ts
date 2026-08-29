"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

import {
  loadWorkbenchSettingsPreferences,
  updateWorkbenchSettingsPreferences,
} from "@/runtime/pi/client/settings/workbench-settings-client";

type Listener = () => void;

export interface HardwareAccelerationPreferenceSnapshot {
  readonly enabled: boolean;
  readonly pendingEnabled?: boolean;
  readonly restartRequired: boolean;
  readonly status: "loading" | "ready" | "saving";
  readonly saveFailed: boolean;
}

const SERVER_SNAPSHOT: HardwareAccelerationPreferenceSnapshot = Object.freeze({
  enabled: true,
  restartRequired: false,
  status: "loading",
  saveFailed: false,
});

let snapshot: HardwareAccelerationPreferenceSnapshot = SERVER_SNAPSHOT;
let hydrationPromise: Promise<void> | undefined;
const listeners = new Set<Listener>();

function emit(nextSnapshot: HardwareAccelerationPreferenceSnapshot): void {
  snapshot = nextSnapshot;
  for (const listener of listeners) listener();
}

export const hardwareAccelerationPreferences = Object.freeze({
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): HardwareAccelerationPreferenceSnapshot {
    return snapshot;
  },
  getServerSnapshot(): HardwareAccelerationPreferenceSnapshot {
    return SERVER_SNAPSHOT;
  },
  hydrate(): Promise<void> {
    if (snapshot.status !== "loading") return Promise.resolve();
    hydrationPromise ??= loadWorkbenchSettingsPreferences()
      .then((preferences) => {
        emit({
          enabled: preferences.hardwareAcceleration !== false,
          restartRequired: false,
          status: "ready",
          saveFailed: false,
        });
      })
      .catch(() => {
        emit({
          enabled: true,
          restartRequired: false,
          status: "ready",
          saveFailed: true,
        });
      })
      .finally(() => {
        hydrationPromise = undefined;
      });
    return hydrationPromise;
  },
  async setEnabled(enabled: boolean): Promise<void> {
    if (snapshot.status === "loading") await this.hydrate();
    if (snapshot.status === "saving" || enabled === snapshot.enabled) return;

    const previousEnabled = snapshot.enabled;
    const previousRestartRequired = snapshot.restartRequired;
    emit({
      enabled: previousEnabled,
      pendingEnabled: enabled,
      restartRequired: previousRestartRequired,
      status: "saving",
      saveFailed: false,
    });
    try {
      await updateWorkbenchSettingsPreferences({ hardwareAcceleration: enabled });
      emit({
        enabled,
        restartRequired: true,
        status: "ready",
        saveFailed: false,
      });
    } catch (error) {
      emit({
        enabled: previousEnabled,
        restartRequired: previousRestartRequired,
        status: "ready",
        saveFailed: true,
      });
      throw error;
    }
  },
});

export function useHardwareAccelerationPreferences(): HardwareAccelerationPreferenceSnapshot {
  const current = useSyncExternalStore(
    hardwareAccelerationPreferences.subscribe,
    hardwareAccelerationPreferences.getSnapshot,
    hardwareAccelerationPreferences.getServerSnapshot,
  );

  useLayoutEffect(() => {
    void hardwareAccelerationPreferences.hydrate();
  }, []);
  return current;
}
