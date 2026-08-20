import * as React from "react";

import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

function SettingsDropdownTrigger({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuTrigger>) {
  return (
    <DropdownMenuTrigger
      data-slot="settings-dropdown-trigger"
      className={cn(
        "bg-muted hover:bg-muted/80 inline-flex h-8 w-fit max-w-full items-center justify-center gap-2 rounded-full px-3 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted/80 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function SettingsDropdownContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="settings-dropdown-content"
      className={cn(
        "w-max min-w-(--anchor-width) max-w-[min(18rem,calc(100vw-2rem))] rounded-xl",
        className,
      )}
      {...props}
    />
  );
}

function SettingsDropdownItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuItem>) {
  return (
    <DropdownMenuItem
      data-slot="settings-dropdown-item"
      className={cn("min-h-8 gap-2 px-2.5 py-1.5", className)}
      {...props}
    />
  );
}

function SettingsDropdownRadioItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuRadioItem>) {
  return (
    <DropdownMenuRadioItem
      data-slot="settings-dropdown-radio-item"
      className={cn("min-h-8 gap-2 py-1.5 pr-8 pl-2.5", className)}
      {...props}
    />
  );
}

export {
  SettingsDropdownContent,
  SettingsDropdownItem,
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
};
