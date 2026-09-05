"use client";

import type { ComponentProps } from "react";

import { CollapsibleContent } from "../ui/collapsible";
import { collapsePanel } from "../ui/surface";
import { cn } from "../utils";

/** Shared height/opacity transition for ordinary and steered completed work. */
export function CompletedTurnContent({
  className,
  ...props
}: ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      {...props}
      className={cn(
        collapsePanel,
        "w-full transition-[height,opacity] outline-none data-open:duration-400 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
        className,
      )}
    />
  );
}
