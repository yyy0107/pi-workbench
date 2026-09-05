"use client";

import type { ComponentProps, ReactNode } from "react";

import { cn } from "../utils";

import { field, floating } from "../ui/surface";

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
        "flex w-full items-center gap-2.5 rounded-[var(--button-radius)] px-2.5 py-2 text-[13.5px] transition-colors",
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
  className,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  command: ComposerCommand;
  active: boolean;
}) {
  return (
    <ComposerMenuItem
      active={active}
      className={cn(
        "grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-lg px-3 py-2 text-start",
        active ? "bg-muted/80 dark:bg-muted/60" : "hover:bg-muted/50 dark:hover:bg-muted/35",
        className,
      )}
      {...props}
    >
      <span className="flex min-w-0 items-baseline gap-2 leading-5">
        <code className="text-blue-600 dark:text-blue-400 shrink-0 text-[13px] font-medium">
          /{command.name}
        </code>
        {command.argumentHint ? (
          <code
            className="text-muted-foreground min-w-0 truncate text-xs font-normal"
            title={command.argumentHint}
          >
            {command.argumentHint}
          </code>
        ) : null}
      </span>
      {command.meta ? (
        <span
          className="text-foreground/40 max-w-48 shrink-0 truncate text-end text-xs! leading-5"
          title={command.meta}
        >
          {command.meta}
        </span>
      ) : null}
      <span className="col-span-2 flex min-w-0 items-baseline gap-1.5 leading-5">
        <span
          className="shrink-0 truncate text-xs! font-medium"
          title={command.label ?? `/${command.name}`}
        >
          {command.label ?? `/${command.name}`}
        </span>
        {command.description !== command.label ? (
          <span
            className="text-foreground/45 min-w-0 flex-1 truncate text-xs!"
            title={command.description}
          >
            {command.description}
          </span>
        ) : null}
      </span>
    </ComposerMenuItem>
  );
}

export function ComposerCommandToken({
  icon,
  label,
  hint,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  icon?: ReactNode;
  label: string;
  hint?: string;
}) {
  return (
    <span
      data-slot="composer-command-token"
      className={cn(
        "relative inline-block min-w-0 whitespace-nowrap align-baseline text-blue-500 dark:text-blue-400",
        className,
      )}
      {...props}
    >
      <span className="inline-flex items-center gap-1 align-baseline">
        {icon ? (
          <span
            data-slot="composer-command-token-icon"
            aria-hidden="true"
            className="aui-composer-icon-size-default inline-flex items-center justify-center [&_svg]:size-full"
          >
            {icon}
          </span>
        ) : null}
        <span>{label}</span>
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
    </span>
  );
}
