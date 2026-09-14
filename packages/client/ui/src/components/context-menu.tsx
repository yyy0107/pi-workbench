"use client";

import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";

import { cn } from "../../lib/utils";
import {
  menuItemStyles,
  menuPopupStyles,
  menuSeparatorStyles,
  type MenuLayoutOptions,
} from "./menu-styles";
import { useWorkbenchPortalContainer } from "./workbench-portal-container";

function ContextMenu({ ...props }: ContextMenuPrimitive.Root.Props) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger({ ...props }: ContextMenuPrimitive.Trigger.Props) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />;
}

function ContextMenuContent({
  className,
  reserveScrollbarSpace = false,
  limitHeight = true,
  ...props
}: ContextMenuPrimitive.Popup.Props & MenuLayoutOptions) {
  const workbenchContainer = useWorkbenchPortalContainer();
  return (
    <ContextMenuPrimitive.Portal container={workbenchContainer}>
      <ContextMenuPrimitive.Positioner className="isolate z-50 outline-none">
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            menuPopupStyles,
            reserveScrollbarSpace && "[scrollbar-gutter:stable]",
            !limitHeight && "max-h-none",
            className,
          )}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({
  className,
  variant = "default",
  ...props
}: ContextMenuPrimitive.Item.Props & {
  variant?: "default" | "destructive";
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-variant={variant}
      className={cn(menuItemStyles, className)}
      {...props}
    />
  );
}

function ContextMenuSeparator({ className, ...props }: ContextMenuPrimitive.Separator.Props) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn(menuSeparatorStyles, className)}
      {...props}
    />
  );
}

export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
};

// Base UI context menus and dropdowns share the same submenu primitives and styling.
export {
  DropdownMenuSub as ContextMenuSub,
  DropdownMenuSubContent as ContextMenuSubContent,
  DropdownMenuSubTrigger as ContextMenuSubTrigger,
} from "./dropdown-menu";
