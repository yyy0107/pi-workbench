"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import {
  getPiResourceCatalogRevision,
  subscribePiResourceCatalog,
} from "@/runtime/pi/client/runtime/resource-catalog-revision";
import { listAvailablePiPackageUpdates } from "@/runtime/pi/client/transport/api";
import type { PiPackageUpdatesValue, PiResourceCatalogTarget } from "@/runtime/pi/contracts/rpc";

const EMPTY_UPDATES: PiPackageUpdatesValue = { updates: [] };

type PackageUpdatesLoadState = "idle" | "loading" | "ready" | "failed";

export function usePiPackageUpdates(target: PiResourceCatalogTarget | undefined, enabled = true) {
  const [value, setValue] = useState<PiPackageUpdatesValue>(EMPTY_UPDATES);
  const [loadState, setLoadState] = useState<PackageUpdatesLoadState>("idle");
  const [reloadRevision, setReloadRevision] = useState(0);
  const resourceCatalogRevision = useSyncExternalStore(
    subscribePiResourceCatalog,
    getPiResourceCatalogRevision,
    () => 0,
  );
  const refresh = useCallback(() => setReloadRevision((revision) => revision + 1), []);

  useEffect(() => {
    let active = true;
    if (!enabled || !target) {
      setValue(EMPTY_UPDATES);
      setLoadState("idle");
      return;
    }

    setValue(EMPTY_UPDATES);
    setLoadState("loading");
    void listAvailablePiPackageUpdates({ target }).then(
      (nextValue) => {
        if (!active) return;
        setValue(nextValue);
        setLoadState("ready");
      },
      () => {
        if (!active) return;
        setValue(EMPTY_UPDATES);
        setLoadState("failed");
      },
    );

    return () => {
      active = false;
    };
  }, [enabled, reloadRevision, resourceCatalogRevision, target]);

  return { loadState, refresh, value } as const;
}
