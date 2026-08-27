"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  loadWorkbenchSettingsPreferences,
  updateWorkbenchSettingsPreferences,
} from "@/runtime/pi/client/settings/workbench-settings-client";
import type { WorkbenchToolboxScopePreference } from "@/runtime/pi/contracts/rpc";

import { USER_TOOLBOX_SCOPE } from "./toolbox-scope";

let hydrated = false;
let localRevision = 0;
let snapshot: WorkbenchToolboxScopePreference = USER_TOOLBOX_SCOPE;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function normalizeScope(
  scope: WorkbenchToolboxScopePreference | undefined,
): WorkbenchToolboxScopePreference {
  if (scope?.kind === "project" && scope.workspaceId) {
    return Object.freeze({ kind: "project", workspaceId: scope.workspaceId });
  }
  return USER_TOOLBOX_SCOPE;
}

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const hydrationRevision = localRevision;
  try {
    const preferences = await loadWorkbenchSettingsPreferences();
    if (localRevision !== hydrationRevision) return;
    snapshot = normalizeScope(preferences.toolboxScope);
    emit();
  } catch {
    // Keep the user scope while the host is unavailable.
  }
}

export function setToolboxScope(scope: WorkbenchToolboxScopePreference): void {
  void hydrate();
  localRevision += 1;
  snapshot = normalizeScope(scope);
  void updateWorkbenchSettingsPreferences({ toolboxScope: snapshot }).catch(() => undefined);
  emit();
}

export function useToolboxScope(): WorkbenchToolboxScopePreference {
  const scope = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => USER_TOOLBOX_SCOPE,
  );

  useEffect(() => {
    void hydrate();
  }, []);

  return scope;
}
