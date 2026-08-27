"use client";

import { useCallback, useEffect, useState } from "react";

import { describeInstalledPiPackage } from "@/runtime/pi/client/transport/api";
import type {
  InstalledPackageDetailsView,
  PiResourceCatalogTarget,
} from "@/runtime/pi/contracts/rpc";

type InstalledPackageDetailsLoadState = "idle" | "loading" | "ready" | "failed";

interface InstalledPackageDetailsState {
  key: string;
  loadState: InstalledPackageDetailsLoadState;
  value?: InstalledPackageDetailsView;
}

function packageDetailsKey(target: PiResourceCatalogTarget | undefined, source: string): string {
  if (!target) return "";
  return target.scope === "user" ? `user\0${source}` : `project\0${target.workspaceId}\0${source}`;
}

export function usePiInstalledPackageDetails(
  target: PiResourceCatalogTarget | undefined,
  source: string,
  enabled: boolean,
) {
  const key = packageDetailsKey(target, source);
  const [state, setState] = useState<InstalledPackageDetailsState>({
    key: "",
    loadState: "idle",
  });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled || !target || !source) {
      setState({ key, loadState: "idle" });
      return;
    }

    let active = true;
    setState({ key, loadState: "loading" });
    void describeInstalledPiPackage({ source, target }).then(
      (value) => {
        if (active) setState({ key, loadState: "ready", value });
      },
      () => {
        if (active) setState({ key, loadState: "failed" });
      },
    );

    return () => {
      active = false;
    };
  }, [enabled, key, revision, source, target]);

  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  const isCurrentPackage = state.key === key;
  return {
    loadState: isCurrentPackage ? state.loadState : enabled ? "loading" : "idle",
    refresh,
    value: isCurrentPackage ? state.value : undefined,
  } as const;
}
