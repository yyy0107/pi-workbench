"use client";

import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";

import type { WorkbenchSettingsPort } from "../settings";

const LEGACY_SIDEBAR_COOKIE_NAME = "sidebar_state";

function readLegacySidebarOpen(): boolean | undefined {
  const prefix = `${LEGACY_SIDEBAR_COOKIE_NAME}=`;
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function clearLegacySidebarOpen(): void {
  document.cookie = `${LEGACY_SIDEBAR_COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
}

export function useSidebarSettingsHydration(
  settings: WorkbenchSettingsPort,
  sidebarRevision: RefObject<number>,
  setSidebarOpen: Dispatch<SetStateAction<boolean>>,
): void {
  const hydration = useRef<ReturnType<typeof settings.load> | null>(null);

  useEffect(() => {
    let active = true;
    const legacyOpen = readLegacySidebarOpen();
    const hydrationRevision = sidebarRevision.current;
    if (legacyOpen !== undefined) setSidebarOpen(legacyOpen);
    const hydrationRequest = (hydration.current ??= Promise.resolve().then(() => settings.load()));

    void (async () => {
      try {
        const preferences = await hydrationRequest;
        if (!active) return;
        if (preferences.sidebarOpen !== undefined) {
          if (sidebarRevision.current === hydrationRevision) {
            setSidebarOpen(preferences.sidebarOpen);
          }
        } else if (sidebarRevision.current === hydrationRevision) {
          await settings.update({ sidebarOpen: legacyOpen ?? true });
          if (!active) return;
        }
        if (!active) return;
        clearLegacySidebarOpen();
      } catch {
        // The default open state remains available when settings hydration fails.
      }
    })();

    return () => {
      active = false;
    };
  }, [settings, setSidebarOpen, sidebarRevision]);
}
