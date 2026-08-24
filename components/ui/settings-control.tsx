import * as React from "react";
import { PencilIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

function SettingsInlineEditor({
  editing,
  display,
  editLabel,
  cancelLabel,
  disabled,
  children,
  className,
  editingClassName,
  editButtonClassName,
  cancelButtonClassName,
  cancelButtonVariant = "ghost",
  onEdit,
  onCancel,
}: {
  editing: boolean;
  display: React.ReactNode;
  editLabel: string;
  cancelLabel: string;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
  editingClassName?: string;
  editButtonClassName?: string;
  cancelButtonClassName?: string;
  cancelButtonVariant?: React.ComponentProps<typeof Button>["variant"];
  onEdit(): void;
  onCancel(): void;
}) {
  if (editing) {
    return (
      <div
        data-slot="settings-inline-editor"
        data-state="editing"
        className={cn("flex w-full max-w-72 items-center justify-end gap-2", editingClassName)}
      >
        <div className="min-w-0 flex-1">{children}</div>
        <Button
          type="button"
          variant={cancelButtonVariant}
          className={cancelButtonClassName}
          disabled={disabled}
          onClick={onCancel}
        >
          {cancelLabel}
        </Button>
      </div>
    );
  }

  return (
    <div
      data-slot="settings-inline-editor"
      data-state="display"
      className={cn("flex min-h-8 items-center justify-end gap-1", className)}
    >
      {display}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn("text-muted-foreground hover:text-foreground", editButtonClassName)}
        disabled={disabled}
        aria-label={editLabel}
        onClick={onEdit}
      >
        <PencilIcon />
      </Button>
    </div>
  );
}

function SettingsDropdownTrigger({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuTrigger>) {
  return (
    <DropdownMenuTrigger
      data-slot="settings-dropdown-trigger"
      className={cn(
        "border border-input bg-transparent hover:bg-muted/80 inline-flex h-8 w-fit max-w-full items-center justify-center gap-2 rounded-full px-3 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted/80 disabled:pointer-events-none disabled:opacity-50",
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

function SettingsDropdownCheckboxItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuCheckboxItem>) {
  return (
    <DropdownMenuCheckboxItem
      data-slot="settings-dropdown-checkbox-item"
      className={cn("min-h-8 gap-2 py-1.5 pr-8 pl-2.5", className)}
      {...props}
    />
  );
}

export {
  SettingsInlineEditor,
  SettingsDropdownCheckboxItem,
  SettingsDropdownContent,
  SettingsDropdownItem,
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
};
