"use client";

import { useEffect, type RefObject } from "react";

import { getWorkbenchDesktopTitleBarPort, readTitleBarOverlay } from "./title-bar-overlay";

/**
 * Keeps a native desktop title-bar overlay aligned with Workbench appearance.
 * Browsers without a desktop bridge intentionally do nothing.
 */
export function DesktopTitleBarOverlaySync({
  ownerRootRef,
}: Readonly<{ ownerRootRef: RefObject<HTMLElement | null> }>) {
  useEffect(() => {
    const port = getWorkbenchDesktopTitleBarPort();
    const owner = ownerRootRef.current;
    if (!port || !owner) return;

    let frame: number | undefined;
    let previousSerializedOverlay: string | undefined;
    const sync = () => {
      frame = undefined;
      const overlay = readTitleBarOverlay(owner);
      if (!overlay) return;

      const serializedOverlay = JSON.stringify(overlay);
      if (serializedOverlay === previousSerializedOverlay) return;
      previousSerializedOverlay = serializedOverlay;
      port.setOverlay(overlay);
    };
    const scheduleSync = () => {
      if (frame !== undefined) return;
      frame = window.requestAnimationFrame(sync);
    };

    const observer = new MutationObserver(scheduleSync);
    observer.observe(owner, {
      attributes: true,
      attributeFilter: ["class", "style", "data-workbench-appearance"],
    });
    window.addEventListener("pageshow", scheduleSync);
    scheduleSync();

    return () => {
      observer.disconnect();
      window.removeEventListener("pageshow", scheduleSync);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [ownerRootRef]);

  return null;
}
