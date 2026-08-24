"use client";

import { useCallback, useEffect, useState } from "react";

import { describePiPackageCatalog } from "@/runtime/pi/client/transport/api";
import type { PiPackageCatalogDetailsView } from "@/runtime/pi/rpc-contracts";

type PackageDetailsLoadState = "idle" | "loading" | "ready" | "failed";

interface PackageDetailsState {
  loadState: PackageDetailsLoadState;
  name: string;
  value?: PiPackageCatalogDetailsView;
}

export function usePiPackageDetails(name: string, enabled: boolean) {
  const [state, setState] = useState<PackageDetailsState>({ loadState: "idle", name: "" });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState({ loadState: "idle", name });
      return;
    }

    let active = true;
    setState({ loadState: "loading", name });
    void describePiPackageCatalog({ name }).then(
      (value) => {
        if (active) setState({ loadState: "ready", name, value });
      },
      () => {
        if (active) setState({ loadState: "failed", name });
      },
    );

    return () => {
      active = false;
    };
  }, [enabled, name, revision]);

  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  const isCurrentPackage = state.name === name;
  return {
    loadState: isCurrentPackage ? state.loadState : enabled ? "loading" : "idle",
    refresh,
    value: isCurrentPackage ? state.value : undefined,
  } as const;
}
