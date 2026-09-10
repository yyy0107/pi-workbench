import { cn } from "../utils";

export const selectorValidationErrorStyles =
  "bg-destructive/5 text-destructive ring-3 ring-destructive/20 dark:ring-destructive/40";

export const menuPopupStyles =
  "z-50 max-h-(--available-height) origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95";

const menuItemBaseStyles =
  "relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 pt-[var(--control-content-padding-block-compact-start)] pb-[var(--control-content-padding-block-compact-end)] text-sm leading-[var(--control-text-line-height)]! outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[var(--icon-size-md)]";

export const menuItemStyles = cn(
  menuItemBaseStyles,
  "focus:[background:var(--control-state-background-selected)] focus:[color:var(--control-state-foreground-selected)] not-data-[variant=destructive]:focus:**:[color:var(--control-state-foreground-selected)] data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:*:[svg]:text-destructive",
);

export const menuChoiceItemStyles = cn(
  menuItemBaseStyles,
  "pr-8 focus:[background:var(--control-state-background-selected)] focus:[color:var(--control-state-foreground-selected)] focus:**:[color:var(--control-state-foreground-selected)] data-inset:pl-7",
);

export const menuSeparatorStyles = "-mx-1 my-1 h-px bg-border";
