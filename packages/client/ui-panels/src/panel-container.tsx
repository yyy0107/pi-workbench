import type { ComponentPropsWithoutRef } from "react";

import type { PanelLocation } from "@workbench/extension-sdk";
import { cn } from "@workbench/ui/utils";
import { resolvePanelDimensions } from "../lib/panel-dimensions";

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
  const dimension = resolvePanelDimensions(location, size);

  return (
    <section
      data-slot="workbench-panel-container"
      data-workbench-surface="panel"
      data-location={location}
      className={cn(
        "bg-background relative flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden",
        location === "left" && "border-r",
        location === "bottom" && "border-t",
        className,
      )}
      style={{ ...dimension, ...style }}
      {...props}
    />
  );
}
