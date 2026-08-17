"use client";

import { useAuiState } from "@assistant-ui/react";
import { RadioIcon } from "lucide-react";

const STATUS = {
  loading: {
    label: "Loading",
    dot: "bg-amber-500",
  },
  streaming: {
    label: "Streaming",
    dot: "bg-blue-500 motion-safe:animate-pulse",
  },
  ready: {
    label: "Ready",
    dot: "bg-emerald-500",
  },
} as const;

export function ConnectionStatus() {
  const phase = useAuiState((state) => {
    if (state.thread.isLoading) return "loading";
    if (state.thread.isRunning) return "streaming";
    return "ready";
  });
  const status = STATUS[phase];

  return (
    <div
      aria-label={`Assistant runtime: ${status.label}`}
      aria-live="polite"
      className="inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground"
      title="Derived from the local assistant runtime"
    >
      <RadioIcon aria-hidden="true" className="size-3" />
      <span className={`size-1.5 rounded-full ${status.dot}`} />
      <span>{status.label}</span>
    </div>
  );
}
