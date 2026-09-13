"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import type { PiResourceCatalogTarget } from "@workbench/agent-runtime-pi-protocol/rpc";
import { usePiResourceClient } from "@workbench/agent-runtime-pi-client/resources";

import { IDLE_PACKAGE_UPDATES_SNAPSHOT } from "./pi-package-updates-query";

export function usePiPackageUpdates(target: PiResourceCatalogTarget | undefined, enabled = true) {
  const { packageUpdatesQuery } = usePiResourceClient();
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
      activeTarget ? packageUpdatesQuery.subscribe(activeTarget, listener) : () => undefined,
    [activeTarget, packageUpdatesQuery],
  );
  const getSnapshot = useCallback(
    () =>
      activeTarget ? packageUpdatesQuery.getSnapshot(activeTarget) : IDLE_PACKAGE_UPDATES_SNAPSHOT,
    [activeTarget, packageUpdatesQuery],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => IDLE_PACKAGE_UPDATES_SNAPSHOT,
  );
  const refresh = useCallback(() => {
    if (activeTarget) void packageUpdatesQuery.refresh(activeTarget);
  }, [activeTarget, packageUpdatesQuery]);

  useEffect(() => {
    if (activeTarget) void packageUpdatesQuery.ensure(activeTarget);
  }, [activeTarget, packageUpdatesQuery]);

  return { ...snapshot, refresh } as const;
}
