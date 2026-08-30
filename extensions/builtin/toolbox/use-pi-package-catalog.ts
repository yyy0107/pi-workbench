"use client";

import { useCallback, useEffect, useState } from "react";

import { searchPiPackageCatalog } from "@/workbench/runtime-contributions/pi/client/resources";
import type {
  PiPackageCatalogFilterType,
  PiPackageCatalogSearchValue,
  PiPackageCatalogSort,
} from "@/workbench/runtime-contributions/pi/protocol/rpc";

const EMPTY_CATALOG: PiPackageCatalogSearchValue = {
  sourceUrl: "https://pi.dev/packages",
  page: 1,
  pageSize: 50,
  pageCount: 0,
  filteredTotal: 0,
  total: 0,
  packages: [],
};

export interface UsePiPackageCatalogOptions {
  enabled?: boolean;
  page?: number;
  query?: string;
  sort?: PiPackageCatalogSort;
  type?: PiPackageCatalogFilterType;
}

export function usePiPackageCatalog({
  enabled = true,
  page = 1,
  query = "",
  sort = "downloads",
  type,
}: UsePiPackageCatalogOptions = {}) {
  const [value, setValue] = useState<PiPackageCatalogSearchValue>(EMPTY_CATALOG);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setLoadState("idle");
      return;
    }

    let active = true;
    setLoadState("loading");
    const timeout = window.setTimeout(() => {
      void searchPiPackageCatalog({
        ...(query.trim() ? { query: query.trim() } : {}),
        ...(type ? { type } : {}),
        ...(sort !== "downloads" ? { sort } : {}),
        ...(page > 1 ? { page } : {}),
      }).then(
        (catalog) => {
          if (!active) return;
          setValue(catalog);
          setLoadState("ready");
        },
        () => {
          if (!active) return;
          setLoadState("failed");
        },
      );
    }, 200);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [enabled, page, query, revision, sort, type]);

  const refresh = useCallback(() => setRevision((current) => current + 1), []);

  return { loadState, refresh, value } as const;
}
