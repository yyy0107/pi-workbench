"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  useWorkbenchSettingsResource,
  type WorkbenchSettingsPort,
} from "@workbench/shell/settings";
import type { WorkbenchToolboxScopePreference } from "@workbench/agent-runtime-contracts/settings";

import { USER_TOOLBOX_SCOPE } from "./toolbox-scope";

export interface ToolboxScopeStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): WorkbenchToolboxScopePreference;
  getServerSnapshot(): WorkbenchToolboxScopePreference;
  hydrate(): Promise<void>;
  setScope(scope: WorkbenchToolboxScopePreference): void;
}

const TOOLBOX_SCOPE_RESOURCE = Symbol("workbench.toolbox-scope-store");

function normalizeScope(
  scope: WorkbenchToolboxScopePreference | undefined,
): WorkbenchToolboxScopePreference {
  if (scope?.kind === "project" && scope.workspaceId) {
    return Object.freeze({ kind: "project", workspaceId: scope.workspaceId });
  }
  return USER_TOOLBOX_SCOPE;
}

export function createToolboxScopeStore(settings: WorkbenchSettingsPort): ToolboxScopeStore {
  let hydrated = false;
  let hydrationPromise: Promise<void> | undefined;
  let localRevision = 0;
  let snapshot: WorkbenchToolboxScopePreference = USER_TOOLBOX_SCOPE;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };
  const hydrate = (): Promise<void> => {
    if (hydrated) return Promise.resolve();
    if (hydrationPromise) return hydrationPromise;
    const hydrationRevision = localRevision;
    hydrationPromise = settings
      .load()
      .then((preferences) => {
        if (localRevision !== hydrationRevision) return;
        snapshot = normalizeScope(preferences.toolboxScope);
        hydrated = true;
        emit();
      })
      .catch(() => {
        // Keep the user scope while the host is unavailable.
      })
      .finally(() => {
        hydrationPromise = undefined;
      });
    return hydrationPromise;
  };

  return Object.freeze({
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => USER_TOOLBOX_SCOPE,
    hydrate,
    setScope(scope: WorkbenchToolboxScopePreference): void {
      void hydrate();
      localRevision += 1;
      snapshot = normalizeScope(scope);
      void settings.update({ toolboxScope: snapshot }).catch(() => undefined);
      emit();
    },
  });
}

function useToolboxScopeStore(): ToolboxScopeStore {
  return useWorkbenchSettingsResource(TOOLBOX_SCOPE_RESOURCE, createToolboxScopeStore);
}

export function useToolboxScope(): WorkbenchToolboxScopePreference {
  const store = useToolboxScopeStore();
  const scope = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  useEffect(() => {
    void store.hydrate();
  }, [store]);
  return scope;
}

export function useSetToolboxScope(): (scope: WorkbenchToolboxScopePreference) => void {
  const store = useToolboxScopeStore();
  return useCallback((scope) => store.setScope(scope), [store]);
}
