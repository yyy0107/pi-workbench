"use client";

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  WorkbenchSettingsPort,
  WorkbenchSettingsPreferencesPatch,
} from "@workbench/agent-runtime-contracts/settings";

export {
  toWorkbenchSettingsJsonObject,
  type WorkbenchBackgroundImagePreference,
  type WorkbenchModelSelectorPreference,
  type WorkbenchSettingsJsonValue,
  type WorkbenchSettingsPreferences,
  type WorkbenchSettingsPreferencesPatch,
  type WorkbenchSettingsPort,
  type WorkbenchSidebarThreadSortMode,
  type WorkbenchToolboxScopePreference,
} from "@workbench/agent-runtime-contracts/settings";

interface WorkbenchSettingsInstallation {
  readonly service: WorkbenchSettingsPort;
  readonly resources: Map<symbol, unknown>;
}

interface DisposableWorkbenchSettingsResource {
  dispose(): void;
}

const WorkbenchSettingsContext = createContext<WorkbenchSettingsInstallation | undefined>(
  undefined,
);

function snapshotWorkbenchSettingsPort(service: WorkbenchSettingsPort): WorkbenchSettingsPort {
  const load = service.load.bind(service);
  const update = service.update.bind(service);
  return Object.freeze({
    load: () => load(),
    update: (patch: WorkbenchSettingsPreferencesPatch) => update(patch),
  });
}

function isDisposableResource(value: unknown): value is DisposableWorkbenchSettingsResource {
  return (
    typeof value === "object" &&
    value !== null &&
    "dispose" in value &&
    typeof value.dispose === "function"
  );
}

function disposeInstallationResources(installation: WorkbenchSettingsInstallation): void {
  for (const resource of installation.resources.values()) {
    if (!isDisposableResource(resource)) continue;
    try {
      resource.dispose();
    } catch (error) {
      console.error("[workbench] failed to dispose a settings presentation resource", error);
    }
  }
  installation.resources.clear();
}

/** Owns one immutable settings port for the surrounding Runtime installation. */
export function WorkbenchSettingsProvider({
  children,
  service,
}: Readonly<{ children: ReactNode; service: WorkbenchSettingsPort }>) {
  const [installation] = useState<WorkbenchSettingsInstallation>(() => ({
    service: snapshotWorkbenchSettingsPort(service),
    resources: new Map(),
  }));
  const lifecycleGeneration = useRef(0);

  useEffect(() => {
    const generation = ++lifecycleGeneration.current;
    return () => {
      queueMicrotask(() => {
        // React Strict Effects immediately replays setup with a newer generation. A real unmount
        // has no replacement setup, so only it owns the final resource disposal.
        if (lifecycleGeneration.current === generation) {
          disposeInstallationResources(installation);
        }
      });
    };
  }, [installation]);

  return createElement(WorkbenchSettingsContext.Provider, { value: installation }, children);
}

export function useWorkbenchSettingsService(): WorkbenchSettingsPort {
  const installation = useContext(WorkbenchSettingsContext);
  if (!installation) {
    throw new Error("WorkbenchSettingsProvider is required by this Workbench installation.");
  }
  return installation.service;
}

/** Resolve one lazily-created presentation resource owned by this settings installation. */
export function useWorkbenchSettingsResource<T>(
  key: symbol,
  create: (service: WorkbenchSettingsPort) => T,
): T {
  const installation = useContext(WorkbenchSettingsContext);
  if (!installation) {
    throw new Error("WorkbenchSettingsProvider is required by this Workbench installation.");
  }
  if (!installation.resources.has(key)) {
    installation.resources.set(key, create(installation.service));
  }
  return installation.resources.get(key) as T;
}
