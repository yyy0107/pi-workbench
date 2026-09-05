import type { ComponentProps } from "react";
import { CheckCircle2Icon, ChevronRightIcon } from "lucide-react";

import { cn } from "../utils";

export function CompletedTurnHeader({
  label,
  className,
  ...props
}: ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "group/trigger text-foreground/55 hover:text-foreground/90 flex w-full items-center gap-1.5 py-1 text-[13.5px] transition-colors outline-none",
        className,
      )}
    >
      <CheckCircle2Icon
        aria-hidden="true"
        className="text-foreground/45 aui-chat-icon-size-default"
      />
      <span className="text-start leading-(--control-text-line-height)">{label}</span>
      <ChevronRightIcon
        aria-hidden="true"
        className="aui-chat-icon-size-default opacity-0 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/trigger:opacity-60 group-focus-visible/trigger:opacity-60 group-data-open/trigger:rotate-90 group-data-open/trigger:opacity-60 motion-reduce:transition-none"
      />
    </button>
  );
}
