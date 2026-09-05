"use client";

import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";

import {
  useWorkbenchSettingsResource,
  type WorkbenchSettingsPort,
} from "@workbench/shell/settings";

import {
  BUILTIN_TOOL_PREFERENCE_KEYS,
  builtinToolEnabled,
  type BuiltinToolPreferenceKey,
  type BuiltinToolName,
} from "@workbench/agent-runtime-contracts/settings";

export const ASK_USER_PREFERENCES_STORAGE_KEY = "workbench.ask-user.v1";

type Listener = () => void;

export interface ToolCapabilityPreferenceSnapshot {
  readonly enabled: boolean;
  readonly pendingEnabled?: boolean;
  readonly status: "loading" | "ready" | "saving";
  readonly saveFailed: boolean;
}

export interface ToolCapabilityPreferences {
  subscribe(listener: Listener): () => void;
  getSnapshot(): ToolCapabilityPreferenceSnapshot;
  getServerSnapshot(): ToolCapabilityPreferenceSnapshot;
  hydrate(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  dispose(): void;
}

export type ToolCapabilityPreferenceKey =
  | "askUserEnabled"
  | "todoEnabled"
  | BuiltinToolPreferenceKey;

const PREFERENCE_RESOURCES: Record<ToolCapabilityPreferenceKey, symbol> = {
  readToolEnabled: Symbol("workbench.read-tool-preferences"),
  bashToolEnabled: Symbol("workbench.bash-tool-preferences"),
  editToolEnabled: Symbol("workbench.edit-tool-preferences"),
  writeToolEnabled: Symbol("workbench.write-tool-preferences"),
  grepToolEnabled: Symbol("workbench.grep-tool-preferences"),
  findToolEnabled: Symbol("workbench.find-tool-preferences"),
  lsToolEnabled: Symbol("workbench.ls-tool-preferences"),

  askUserEnabled: Symbol("workbench.ask-user-preferences"),
  todoEnabled: Symbol("workbench.todo-preferences"),
};

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

export function createToolCapabilityPreferences(
  settings: WorkbenchSettingsPort,
  key: ToolCapabilityPreferenceKey = "askUserEnabled",
): ToolCapabilityPreferences {
  const builtinName = (Object.keys(BUILTIN_TOOL_PREFERENCE_KEYS) as BuiltinToolName[]).find(
    (name) => BUILTIN_TOOL_PREFERENCE_KEYS[name] === key,
  );
  const defaultEnabled = builtinName
    ? builtinToolEnabled(builtinName, {})
    : key === "askUserEnabled";
  const serverSnapshot: ToolCapabilityPreferenceSnapshot = Object.freeze({
    enabled: defaultEnabled,
    status: "loading",
    saveFailed: false,
  });
  const clearLegacy = () => {
    if (key === "askUserEnabled") removeLegacyPreference();
  };
  let snapshot: ToolCapabilityPreferenceSnapshot = serverSnapshot;
  let hydrationPromise: Promise<void> | undefined;
  let closed = false;
  const listeners = new Set<Listener>();

  const emit = (nextSnapshot: ToolCapabilityPreferenceSnapshot) => {
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
        if (typeof preferences[key] === "boolean") {
          if (closed) return;
          clearLegacy();
          if (closed) return;
          emit({
            enabled: preferences[key],
            status: "ready",
            saveFailed: false,
          });
          return;
        }

        const legacyEnabled = key === "askUserEnabled" ? readLegacyPreference() : undefined;
        if (legacyEnabled !== undefined) {
          if (closed) return;
          await settings.update({ [key]: legacyEnabled });
          if (closed) return;
          clearLegacy();
        }
        if (closed) return;
        emit({
          enabled:
            legacyEnabled ??
            (builtinName ? builtinToolEnabled(builtinName, preferences) : defaultEnabled),
          status: "ready",
          saveFailed: false,
        });
      } catch {
        if (closed) return;
        emit({ enabled: defaultEnabled, status: "ready", saveFailed: true });
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
    getSnapshot(): ToolCapabilityPreferenceSnapshot {
      return snapshot;
    },
    getServerSnapshot(): ToolCapabilityPreferenceSnapshot {
      return serverSnapshot;
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
        await settings.update({ [key]: enabled });
        if (closed) return;
        clearLegacy();
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

function useToolCapabilityPreferencesStore(
  key: ToolCapabilityPreferenceKey,
): ToolCapabilityPreferences {
  return useWorkbenchSettingsResource(PREFERENCE_RESOURCES[key], (settings) =>
    createToolCapabilityPreferences(settings, key),
  );
}

export function useToolCapabilityPreferences(
  key: ToolCapabilityPreferenceKey,
): ToolCapabilityPreferenceSnapshot {
  const store = useToolCapabilityPreferencesStore(key);
  const current = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  useLayoutEffect(() => {
    void store.hydrate();
  }, [store]);
  return current;
}

export function useToolCapabilityPreferencesController(key: ToolCapabilityPreferenceKey): Readonly<{
  setEnabled(enabled: boolean): Promise<void>;
}> {
  const store = useToolCapabilityPreferencesStore(key);
  return useMemo(() => ({ setEnabled: store.setEnabled }), [store]);
}
