import type { CSSProperties } from "react";

import type { PanelLocation } from "@workbench/extension-sdk";

export function resolvePanelDimensions(location: PanelLocation, size: number): CSSProperties {
  return location === "bottom"
    ? { height: `min(${size}px, 100%)`, maxHeight: "100%" }
    : { width: `min(${size}px, 100%)`, maxWidth: "100%" };
}
