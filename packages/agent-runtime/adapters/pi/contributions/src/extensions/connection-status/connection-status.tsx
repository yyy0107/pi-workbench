"use client";

import { useSessionState } from "@workbench/agent-runtime-client";

import { usePiI18n } from "../../i18n";

const STATUS = {
  loading: {
    dot: "bg-amber-500",
  },
  streaming: {
    dot: "bg-blue-500 motion-safe:animate-pulse",
  },
  ready: {
    dot: "bg-emerald-500",
  },
} as const;

export function ConnectionStatus() {
  const { t } = usePiI18n();
  const phase = useSessionState((state) => {
    if (state.isLoading) return "loading";
    if (state.isRunning) return "streaming";
    return "ready";
  });
  const status = STATUS[phase];
  const label = t(`extensions.connectionStatus.${phase}`);

  return (
    <div
      aria-label={t("extensions.connectionStatus.accessibleLabel", { status: label })}
      aria-live="polite"
      className="inline-flex h-6 w-1.5 shrink-0 items-center justify-center"
      title={label}
    >
      <span className={`size-1.5 rounded-full ${status.dot}`} />
    </div>
  );
}
