"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "../utils";

export const paper =
  "bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-16px_rgba(0,0,0,0.12)] dark:bg-popover dark:shadow-none";

export const mutedPaper =
  "bg-muted shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-16px_rgba(0,0,0,0.12)] dark:shadow-none";

export const floating =
  "bg-background shadow-[0_2px_8px_rgba(0,0,0,0.05),0_20px_48px_-16px_rgba(0,0,0,0.18)] dark:bg-popover dark:shadow-[0_20px_48px_-16px_rgba(0,0,0,0.55)]";

export const field = "bg-foreground/[0.04] dark:bg-foreground/[0.06]";

const surfaceVariants = cva("text-foreground", {
  variants: {
    variant: {
      paper,
      muted: mutedPaper,
      floating,
      field,
    },
  },
  defaultVariants: {
    variant: "paper",
  },
});

/** Generic themed surface for cards, floating layers, and recessed fields. */
function Surface({
  className,
  variant = "paper",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof surfaceVariants>) {
  return (
    <div
      data-slot="surface"
      data-variant={variant}
      className={cn(surfaceVariants({ variant }), className)}
      {...props}
    />
  );
}

const labelSwap =
  "col-start-1 row-start-1 flex w-max items-center gap-1.5 leading-(--control-text-line-height) transition-[opacity,filter] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none";

const labelSwapIn = "opacity-100 blur-none";

const labelSwapOut = "pointer-events-none select-none opacity-0 blur-[2px]";

export const collapsePanel =
  "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none";

export const mono = "font-mono text-[11px] tracking-tight";

export function ShimmerLabel({
  active = true,
  className,
  ...props
}: ComponentProps<"span"> & { active?: boolean }) {
  return (
    <span className={cn(active && "shimmer motion-reduce:animate-none", className)} {...props} />
  );
}

/**
 * Scroll region for content that keeps its own whitespace. `whitespace-pre` in
 * a bounded box clips a long line with no way to reach it, so the rows scroll
 * instead.
 *
 * `codeSurface` wraps all the rows as one block, and the rows are its children.
 * It cannot go on each row: `min-width: 100%` resolves against the scroll
 * container's visible width rather than its scroll width, so a per-row width
 * leaves every row except the longest ending its background at the fold.
 */
export const codeScroll = "overflow-x-auto";

export const codeSurface = "w-max min-w-full";

export function SwapLabel({
  active,
  children,
  className,
}: {
  active: 0 | 1;
  children: [React.ReactNode, React.ReactNode];
  className?: string;
}) {
  const layers = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const target = layers[active]?.current;
    if (!target) return undefined;
    const measure = () => setWidth(target.offsetWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, [active]);

  return (
    <span
      style={width === null ? undefined : { width }}
      className={cn(
        "grid overflow-x-clip transition-[width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
        className,
      )}
    >
      {children.map((layer, index) => (
        <span
          key={index}
          ref={layers[index]}
          aria-hidden={active !== index}
          className={cn(labelSwap, active === index ? labelSwapIn : labelSwapOut)}
        >
          {layer}
        </span>
      ))}
    </span>
  );
}

export { Surface, surfaceVariants };
