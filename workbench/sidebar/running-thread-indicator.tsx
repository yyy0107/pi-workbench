import type { ComponentType } from "react";
import { LoaderCircleIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { RunningIndicatorId } from "@/services/appearance/appearance-preferences";

function OrbIndicator() {
  return (
    <span className="text-foreground/70 relative block size-5 [contain:strict]">
      <span className="absolute inset-[2px] rounded-full border border-dotted border-current opacity-20" />
      <span className="absolute inset-[1px] animate-spin [animation-duration:1.15s] [will-change:transform] motion-reduce:animate-none">
        <span className="absolute start-1/2 top-0 size-1 -translate-x-1/2 rounded-full bg-current" />
      </span>
      <span className="absolute inset-[4px] animate-spin [animation-delay:-0.35s] [animation-direction:reverse] [animation-duration:0.8s] [will-change:transform] motion-reduce:animate-none">
        <span className="absolute end-0 top-1/2 size-1 -translate-y-1/2 rounded-full bg-current opacity-75" />
      </span>
      <span className="absolute inset-[6px] animate-spin [animation-delay:-0.7s] [animation-duration:1.4s] [will-change:transform] motion-reduce:animate-none">
        <span className="absolute bottom-0 start-1/2 size-0.5 -translate-x-1/2 rounded-full bg-current opacity-55" />
      </span>
    </span>
  );
}

function SpinnerIndicator() {
  return (
    <LoaderCircleIcon
      aria-hidden="true"
      className="size-4 animate-spin motion-reduce:animate-none"
    />
  );
}

function PulseIndicator() {
  return (
    <span aria-hidden="true" className="relative flex size-3 items-center justify-center">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-500/60 motion-reduce:hidden" />
      <span className="inline-flex size-2 rounded-full bg-blue-500 dark:bg-blue-400" />
    </span>
  );
}

function HiddenIndicator() {
  return null;
}

const RUNNING_INDICATOR_COMPONENTS = {
  orb: OrbIndicator,
  spinner: SpinnerIndicator,
  pulse: PulseIndicator,
  none: HiddenIndicator,
} satisfies Record<RunningIndicatorId, ComponentType>;

export function RunningThreadIndicator({
  id,
  className,
}: {
  id: RunningIndicatorId;
  className?: string;
}) {
  const Indicator = RUNNING_INDICATOR_COMPONENTS[id];
  if (id === "none") return null;

  return (
    <span aria-hidden="true" className={cn("flex size-5 items-center justify-center", className)}>
      <Indicator />
    </span>
  );
}
