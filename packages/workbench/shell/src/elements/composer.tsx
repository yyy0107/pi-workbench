"use client";

import type { ComponentProps, ReactNode } from "react";

import { cn } from "../utils";

import { field, floating } from "../ui/surface";
import { StatusBadge } from "../ui/status-badge";
import { withTooltip } from "../ui/tooltip";

export interface ComposerCommand {
  name: string;
  label?: string;
  description: string;
  meta?: string;
  argumentHint?: string;
}

export function ComposerMenu({
  open,
  align = "start",
  className,
  ...props
}: ComponentProps<"div"> & { open: boolean; align?: "start" | "end" }) {
  return (
    <div
      data-slot="composer-menu"
      data-open={open || undefined}
      className={cn(
        floating,
        "absolute bottom-full z-10 mb-2 flex w-72 flex-col gap-0.5 rounded-2xl p-1.5",
        align === "start" ? "start-0 origin-bottom-left" : "end-0 origin-bottom-right",
        "transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
        open ? "scale-100 opacity-100" : "pointer-events-none scale-[0.97] opacity-0",
        className,
      )}
      {...props}
    />
  );
}

function ComposerMenuItem({
  active = false,
  className,
  ...props
}: ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      data-slot="composer-menu-item"
      data-active={active || undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[var(--button-radius)] px-2.5 pt-[var(--control-content-padding-block-compact-start)] pb-[var(--control-content-padding-block-compact-end)] text-[13.5px] transition-colors",
        active ? field : "hover:bg-foreground/[0.04]",
        className,
      )}
      {...props}
    />
  );
}

export function ComposerCommandItem({
  command,
  active,
  icon,
  iconClassName,
  iconSize,
  className,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  command: ComposerCommand;
  active: boolean;
  icon?: ReactNode;
  iconClassName?: string;
  iconSize?: "default" | "md-lg" | "lg";
}) {
  const triggerLabel = command.label ?? command.name;

  return (
    <ComposerMenuItem
      active={active}
      className={cn(
        "min-w-0 gap-3 rounded-lg px-3 text-start",
        active ? "bg-muted/80 dark:bg-muted/60" : "hover:bg-muted/50 dark:hover:bg-muted/35",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span
          data-slot="composer-command-item-icon"
          aria-hidden="true"
          className={cn(
            "text-muted-foreground aui-composer-icon-size-default inline-flex shrink-0 items-center justify-center [&_svg]:size-full",
            iconSize === "md-lg" && "aui-composer-icon-size-md-lg",
            iconClassName,
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 items-baseline gap-2 leading-5">
        {withTooltip(
          <code
            className="text-foreground min-w-0 truncate text-[13px] font-medium"
            title={triggerLabel}
          >
            {triggerLabel}
          </code>,
        )}
        {command.argumentHint
          ? withTooltip(
              <code
                className="text-muted-foreground min-w-0 truncate text-xs font-normal"
                title={command.argumentHint}
              >
                {command.argumentHint}
              </code>,
            )
          : null}
        {command.description !== command.label
          ? withTooltip(
              <span
                className="text-foreground/45 min-w-0 flex-1 truncate text-xs!"
                title={command.description}
              >
                {command.description}
              </span>,
            )
          : null}
      </span>
      {command.meta ? (
        <StatusBadge className="max-w-48 shrink-0 truncate" title={command.meta}>
          {command.meta}
        </StatusBadge>
      ) : null}
    </ComposerMenuItem>
  );
}

export function ComposerCommandToken({
  icon,
  iconClassName,
  iconSize,
  label,
  hint,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  icon?: ReactNode;
  iconClassName?: string;
  iconSize?: "default" | "md-lg" | "lg";
  label: string;
  hint?: string;
}) {
  return withTooltip(
    <span
      data-slot="composer-command-token"
      className={cn(
        "relative inline-block min-w-0 whitespace-nowrap align-baseline text-primary",
        className,
      )}
      {...props}
    >
      <span className="inline-flex items-center gap-1 align-baseline">
        {icon ? (
          <span
            data-slot="composer-command-token-icon"
            aria-hidden="true"
            className={cn(
              "aui-composer-icon-size-default inline-flex items-center justify-center [&_svg]:size-full",
              iconSize === "md-lg" && "aui-composer-icon-size-md-lg",
              iconClassName,
            )}
          >
            {icon}
          </span>
        ) : null}
        <span className="self-baseline">{label}</span>
      </span>
      {hint ? (
        <span
          data-slot="composer-command-argument-placeholder"
          aria-hidden="true"
          className="text-muted-foreground/70 pointer-events-none absolute start-full top-1/2 ms-2 w-[min(24rem,55vw)] -translate-y-1/2 truncate text-sm font-normal"
        >
          {hint}
        </span>
      ) : null}
    </span>,
  );
}
