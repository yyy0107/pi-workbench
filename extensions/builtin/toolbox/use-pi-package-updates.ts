"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import type { PiResourceCatalogTarget } from "@/workbench/runtime-contributions/pi/protocol/rpc";

import { IDLE_PACKAGE_UPDATES_SNAPSHOT, piPackageUpdatesQuery } from "./pi-package-updates-query";

export function usePiPackageUpdates(target: PiResourceCatalogTarget | undefined, enabled = true) {
  const scope = target?.scope;
  const workspaceId = target?.scope === "project" ? target.workspaceId : undefined;
  const requestTarget = useMemo<PiResourceCatalogTarget | undefined>(
    () =>
      scope === "user"
        ? { scope: "user" }
        : scope === "project" && workspaceId
          ? { scope: "project", workspaceId }
          : undefined,
    [scope, workspaceId],
  );
  const activeTarget = enabled ? requestTarget : undefined;
  const subscribe = useCallback(
    (listener: () => void) =>
      activeTarget ? piPackageUpdatesQuery.subscribe(activeTarget, listener) : () => undefined,
    [activeTarget],
  );
  const getSnapshot = useCallback(
    () =>
      activeTarget
        ? piPackageUpdatesQuery.getSnapshot(activeTarget)
        : IDLE_PACKAGE_UPDATES_SNAPSHOT,
    [activeTarget],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => IDLE_PACKAGE_UPDATES_SNAPSHOT,
  );
  const refresh = useCallback(() => {
    if (activeTarget) void piPackageUpdatesQuery.refresh(activeTarget);
  }, [activeTarget]);

  useEffect(() => {
    if (activeTarget) void piPackageUpdatesQuery.ensure(activeTarget);
  }, [activeTarget]);

  return { ...snapshot, refresh } as const;
}
