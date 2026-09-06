"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../utils";
import { withTooltip } from "./tooltip";

const statusBadgeVariants = cva(
  "inline-flex min-h-5 w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-none font-medium",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted text-muted-foreground",
        info: "border-info/20 bg-info/10 text-info-foreground",
        success: "border-success/20 bg-success/10 text-success-foreground",
        warning: "border-warning/25 bg-warning/10 text-warning-foreground",
        danger: "border-danger/20 bg-danger/10 text-danger-foreground",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

/** Compact status label using only shared semantic state colors. */
function StatusBadge({
  className,
  tone = "neutral",
  ...props
}: ComponentProps<"span"> & VariantProps<typeof statusBadgeVariants>) {
  return withTooltip(
    <span
      data-slot="status-badge"
      data-tone={tone}
      className={cn(statusBadgeVariants({ tone }), className)}
      {...props}
    />,
  );
}

export { StatusBadge, statusBadgeVariants };
