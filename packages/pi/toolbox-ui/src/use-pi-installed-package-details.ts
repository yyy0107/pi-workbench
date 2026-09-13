"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { usePiResourceClient } from "@workbench/agent-runtime-pi-client/resources";
import type {
  InstalledPackageDetailsView,
  PiResourceCatalogTarget,
} from "@workbench/agent-runtime-pi-protocol/rpc";

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
  const resourceClient = usePiResourceClient();
  const key = packageDetailsKey(target, source);
  const catalogRevision = useSyncExternalStore(
    resourceClient.subscribeCatalog,
    resourceClient.getCatalogRevision,
    resourceClient.getCatalogRevision,
  );
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
    void resourceClient.describeInstalledPackage({ source, target }).then(
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
  }, [catalogRevision, enabled, key, resourceClient, revision, source, target]);

  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  const isCurrentPackage = state.key === key;
  return {
    loadState: isCurrentPackage ? state.loadState : enabled ? "loading" : "idle",
    refresh,
    value: isCurrentPackage ? state.value : undefined,
  } as const;
}
