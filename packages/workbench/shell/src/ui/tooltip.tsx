"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cloneElement, type AriaAttributes, type ReactElement } from "react";

import { cn } from "../utils";
import { useWorkbenchPortalContainer } from "./workbench-portal-container";

function TooltipProvider({ ...props }: TooltipPrimitive.Provider.Props) {
  // Keep delay groups local; one immediate tooltip otherwise speeds up unrelated hints.
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" {...props} />;
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

/** Replace a native title; inherit Base UI's 600 ms hover delay, or pass 0 for action hints. */
function withTooltip(
  element: ReactElement<AriaAttributes & { title?: string }>,
  delay?: number,
): ReactElement {
  if (!Object.hasOwn(element.props, "title")) return element;

  // An explicit Tooltip already owns this element, including render-prop composition.
  if (Object.hasOwn(element.props, "data-base-ui-tooltip-trigger")) {
    return cloneElement(element, { title: undefined });
  }

  const { title, "aria-label": label, "aria-labelledby": labelledBy } = element.props;
  const trigger = cloneElement(element, {
    title: undefined,
    "aria-label": label ?? (labelledBy ? undefined : title),
  });
  return (
    <Tooltip key={element.key} disabled={!title}>
      <TooltipPrimitive.Trigger render={trigger} delay={delay} data-popup-open={undefined} />
      <TooltipContent className="whitespace-pre-line [overflow-wrap:anywhere]">
        {title}
      </TooltipContent>
    </Tooltip>
  );
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  const workbenchContainer = useWorkbenchPortalContainer();
  return (
    <TooltipPrimitive.Portal container={workbenchContainer}>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 inline-flex min-h-[var(--button-height-compact)] w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-xl border border-border bg-popover px-2.5 py-[var(--control-content-padding-block-compact)] text-xs text-popover-foreground has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, withTooltip };
