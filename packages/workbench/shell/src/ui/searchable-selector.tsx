"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import * as React from "react";

import { cn } from "../utils";
import { useWorkbenchPortalContainer } from "./workbench-portal-container";

/**
 * Searchable single- or multi-value selector backed by Base UI Combobox.
 * Compose a trigger with `SearchableSelectorContent`; the content owns the
 * installation-local Workbench portal.
 */
function SearchableSelector<Value, Multiple extends boolean | undefined = false>(
  props: ComboboxPrimitive.Root.Props<Value, Multiple>,
) {
  return <ComboboxPrimitive.Root {...props} />;
}

function SearchableSelectorTrigger({
  className,
  children,
  ...props
}: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="searchable-selector-trigger"
      className={cn(
        "group/searchable-selector inline-flex h-[var(--dropdown-control-height)] min-w-0 items-center justify-between gap-2 rounded-[var(--input-control-radius)] border [border-color:var(--input-control-border)] [background:var(--input-control-background)] px-2.5 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] text-sm leading-[var(--control-text-line-height)]! outline-none transition-colors hover:[background:var(--button-background-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-popup-open:[background:var(--button-background-selected)] data-popup-open:[color:var(--button-foreground-selected)] data-placeholder:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[var(--button-icon-size,var(--icon-size-md))]",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon
        aria-hidden="true"
        className="size-[var(--input-control-icon-size)] shrink-0 opacity-50 transition-transform group-data-popup-open/searchable-selector:rotate-180"
      />
    </ComboboxPrimitive.Trigger>
  );
}

function SearchableSelectorValue(props: ComboboxPrimitive.Value.Props) {
  return <ComboboxPrimitive.Value {...props} />;
}

function SearchableSelectorInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="searchable-selector-input"
      className={cn(
        "h-[var(--input-control-height)] w-full border-b border-border bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** Popup props plus the commonly configured anchor-positioning options. */
type SearchableSelectorContentProps = ComboboxPrimitive.Popup.Props &
  Pick<ComboboxPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">;

function SearchableSelectorContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  ...props
}: SearchableSelectorContentProps) {
  const workbenchContainer = useWorkbenchPortalContainer();
  return (
    <ComboboxPrimitive.Portal container={workbenchContainer}>
      <ComboboxPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <ComboboxPrimitive.Popup
          data-slot="searchable-selector-content"
          className={cn(
            "z-50 max-h-(--available-height) min-w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0",
            className,
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function SearchableSelectorList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="searchable-selector-list"
      className={cn(
        "max-h-72 overflow-y-auto overscroll-contain p-1 scroll-py-1 empty:p-0",
        className,
      )}
      {...props}
    />
  );
}

function SearchableSelectorCollection(props: ComboboxPrimitive.Collection.Props) {
  return <ComboboxPrimitive.Collection {...props} />;
}

function SearchableSelectorEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="searchable-selector-empty"
      className={cn("px-2.5 py-4 text-center text-sm text-muted-foreground empty:p-0", className)}
      {...props}
    />
  );
}

function SearchableSelectorGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return (
    <ComboboxPrimitive.Group
      data-slot="searchable-selector-group"
      className={cn("py-0.5", className)}
      {...props}
    />
  );
}

function SearchableSelectorGroupLabel({ className, ...props }: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="searchable-selector-group-label"
      className={cn("px-2 py-1 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

function SearchableSelectorItem({ className, children, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="searchable-selector-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-md px-2 pt-[var(--control-content-padding-block-compact-start)] pe-8 pb-[var(--control-content-padding-block-compact-end)] text-sm leading-[var(--control-text-line-height)]! outline-hidden select-none data-highlighted:[background:var(--control-state-background-selected)] data-highlighted:[color:var(--control-state-foreground-selected)] data-highlighted:**:[color:var(--control-state-foreground-selected)] data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[var(--icon-size-md)]",
        className,
      )}
      {...props}
    >
      {children}
      <SearchableSelectorItemIndicator />
    </ComboboxPrimitive.Item>
  );
}

function SearchableSelectorItemIndicator({
  className,
  children,
  ...props
}: ComboboxPrimitive.ItemIndicator.Props) {
  return (
    <ComboboxPrimitive.ItemIndicator
      data-slot="searchable-selector-item-indicator"
      className={cn(
        "pointer-events-none absolute end-2 flex items-center justify-center",
        className,
      )}
      {...props}
    >
      {children ?? <CheckIcon />}
    </ComboboxPrimitive.ItemIndicator>
  );
}

function SearchableSelectorStatus({ className, ...props }: ComboboxPrimitive.Status.Props) {
  return (
    <ComboboxPrimitive.Status
      data-slot="searchable-selector-status"
      className={cn("px-2.5 py-2 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function SearchableSelectorClear({ className, ...props }: ComboboxPrimitive.Clear.Props) {
  return (
    <ComboboxPrimitive.Clear
      data-slot="searchable-selector-clear"
      className={cn(
        "inline-flex size-[var(--icon-frame-size-compact)] items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export {
  SearchableSelector,
  SearchableSelectorClear,
  SearchableSelectorCollection,
  SearchableSelectorContent,
  SearchableSelectorEmpty,
  SearchableSelectorGroup,
  SearchableSelectorGroupLabel,
  SearchableSelectorInput,
  SearchableSelectorItem,
  SearchableSelectorItemIndicator,
  SearchableSelectorList,
  SearchableSelectorStatus,
  SearchableSelectorTrigger,
  SearchableSelectorValue,
};
export type { SearchableSelectorContentProps };
