"use client";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@workbench/ui/utils";
import { withTooltip } from "@workbench/ui";

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
              "aui-input-token-icon-size-default inline-flex items-center justify-center [&_svg]:size-full",
              iconSize === "md-lg" && "aui-input-token-icon-size-md-lg",
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
