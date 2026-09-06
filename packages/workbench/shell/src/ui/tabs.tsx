"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

import { cn } from "../utils";
import { withTooltip } from "./tooltip";

/** Accessible tab set backed by Base UI's roving-focus and activation behavior. */
function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex min-w-0 flex-col", className)}
      {...props}
    />
  );
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "relative inline-flex min-h-[var(--button-height-default)] w-fit items-center gap-0.5 rounded-[var(--button-radius)] bg-muted p-0.5 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return withTooltip(
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative z-10 inline-flex min-h-[var(--button-height-compact)] min-w-[var(--button-height-compact)] items-center justify-center gap-1.5 rounded-[min(var(--radius-md),10px)] px-2.5 text-sm font-medium whitespace-nowrap outline-none transition-colors select-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-active:bg-background data-active:text-foreground data-active:shadow-sm disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />,
    0,
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn(
        "min-w-0 flex-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
      {...props}
    />
  );
}

function TabsIndicator({ className, ...props }: TabsPrimitive.Indicator.Props) {
  return (
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      className={cn(
        "absolute top-0 left-0 h-full w-(--active-tab-width) translate-x-(--active-tab-left) rounded-[min(var(--radius-md),10px)] bg-background shadow-sm transition-[translate,width] duration-150 motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger };
