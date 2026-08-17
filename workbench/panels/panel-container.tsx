import type { ComponentPropsWithoutRef } from "react";

import type { PanelLocation } from "@/platform/extensions";
import { cn } from "@/lib/utils";

export interface PanelContainerProps extends ComponentPropsWithoutRef<"section"> {
  location: PanelLocation;
  size: number;
}

export function PanelContainer({
  location,
  size,
  className,
  style,
  ...props
}: PanelContainerProps) {
  const dimension =
    location === "bottom"
      ? { height: `min(${size}px, 100%)`, maxHeight: "100%" }
      : { width: `min(${size}px, 100%)`, maxWidth: "100%" };

  return (
    <section
      data-slot="workbench-panel-container"
      data-location={location}
      className={cn(
        "bg-background relative flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden",
        location === "left" && "border-r",
        location === "right" && "border-l",
        location === "bottom" && "border-t",
        className,
      )}
      style={{ ...dimension, ...style }}
      {...props}
    />
  );
}
