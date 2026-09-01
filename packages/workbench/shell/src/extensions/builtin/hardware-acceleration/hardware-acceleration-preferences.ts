"use client";

import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";

import { useWorkbenchSettingsResource, type WorkbenchSettingsPort } from "../../../settings";

type Listener = () => void;

export interface HardwareAccelerationPreferenceSnapshot {
  readonly enabled: boolean;
  readonly pendingEnabled?: boolean;
  readonly restartRequired: boolean;
  readonly status: "loading" | "ready" | "saving";
  readonly saveFailed: boolean;
}

export interface HardwareAccelerationPreferences {
  subscribe(listener: Listener): () => void;
  getSnapshot(): HardwareAccelerationPreferenceSnapshot;
  getServerSnapshot(): HardwareAccelerationPreferenceSnapshot;
  hydrate(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
}

const SERVER_SNAPSHOT: HardwareAccelerationPreferenceSnapshot = Object.freeze({
  enabled: true,
  restartRequired: false,
  status: "loading",
  saveFailed: false,
});
const HARDWARE_ACCELERATION_RESOURCE = Symbol("workbench.hardware-acceleration-preferences");

export function createHardwareAccelerationPreferences(
  settings: WorkbenchSettingsPort,
): HardwareAccelerationPreferences {
  let snapshot: HardwareAccelerationPreferenceSnapshot = SERVER_SNAPSHOT;
  let hydrationPromise: Promise<void> | undefined;
  const listeners = new Set<Listener>();

  const emit = (nextSnapshot: HardwareAccelerationPreferenceSnapshot) => {
    snapshot = nextSnapshot;
    for (const listener of listeners) listener();
  };
  const hydrate = (): Promise<void> => {
    if (snapshot.status !== "loading") return Promise.resolve();
    hydrationPromise ??= settings
      .load()
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
  };

  return Object.freeze({
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
    hydrate,
    async setEnabled(enabled: boolean): Promise<void> {
      if (snapshot.status === "loading") await hydrate();
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
        await settings.update({ hardwareAcceleration: enabled });
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
}

function useHardwareAccelerationStore(): HardwareAccelerationPreferences {
  return useWorkbenchSettingsResource(
    HARDWARE_ACCELERATION_RESOURCE,
    createHardwareAccelerationPreferences,
  );
}

export function useHardwareAccelerationPreferences(): HardwareAccelerationPreferenceSnapshot {
  const store = useHardwareAccelerationStore();
  const current = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  useLayoutEffect(() => {
    void store.hydrate();
  }, [store]);
  return current;
}

export function useHardwareAccelerationController(): Readonly<{
  setEnabled(enabled: boolean): Promise<void>;
}> {
  const store = useHardwareAccelerationStore();
  return useMemo(() => ({ setEnabled: store.setEnabled }), [store]);
}
