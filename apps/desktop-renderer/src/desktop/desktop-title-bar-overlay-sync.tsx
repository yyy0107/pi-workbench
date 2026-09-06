"use client";

import { useEffect, type RefObject } from "react";

import {
  defineTitleBarOverlay,
  type DesktopTitleBarPort,
  type TitleBarOverlay,
} from "@workbench/desktop-contracts/title-bar";

function readDesktopTitleBarPort(value: unknown): DesktopTitleBarPort | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const titleBar = (value as { readonly titleBar?: unknown }).titleBar;
  if (typeof titleBar !== "object" || titleBar === null || Array.isArray(titleBar)) {
    return undefined;
  }
  if (!("setOverlay" in titleBar) || typeof titleBar.setOverlay !== "function") return undefined;
  return titleBar as unknown as DesktopTitleBarPort;
}

function byteToHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function cssColorToHex(color: string, document_: Document): string | undefined {
  const canvas = document_.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;

  context.clearRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  if (alpha !== 255) return undefined;
  return `#${byteToHex(red)}${byteToHex(green)}${byteToHex(blue)}`;
}

function readTitleBarOverlay(owner: HTMLElement): TitleBarOverlay | undefined {
  const document_ = owner.ownerDocument;
  const probe = document_.createElement("div");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.color = "var(--foreground)";
  owner.append(probe);

  const style = getComputedStyle(probe);
  const symbolColor = cssColorToHex(style.color, document_);
  probe.remove();
  if (!symbolColor) return undefined;
  // The full-width Workbench header already paints the background, opacity, and blur.
  // Electron's native color parser requires an explicit alpha value, not `transparent`.
  return defineTitleBarOverlay({ color: "#00000000", symbolColor });
}

/** Sync Workbench appearance through the container-neutral desktop title-bar capability. */
export function DesktopTitleBarOverlaySync({
  ownerRootRef,
}: Readonly<{ ownerRootRef: RefObject<HTMLElement | null> }>) {
  useEffect(() => {
    const port = readDesktopTitleBarPort(window.workbenchDesktop);
    const owner = ownerRootRef.current;
    if (!port || !owner) return;

    let frame: number | undefined;
    let previousOverlay: string | undefined;
    const sync = () => {
      frame = undefined;
      const overlay = readTitleBarOverlay(owner);
      if (!overlay) return;
      const serialized = JSON.stringify(overlay);
      if (serialized === previousOverlay) return;
      previousOverlay = serialized;
      port.setOverlay(overlay);
    };
    const scheduleSync = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(sync);
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
