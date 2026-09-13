"use client";
import { statusUiTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";

import { useSessionState } from "@workbench/agent-runtime-client";

import { withTooltip } from "@workbench/ui";

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
  const { t } = useI18n(statusUiTranslationBundle);
  const phase = useSessionState((state) => {
    if (state.isLoading) return "loading";
    if (state.isRunning) return "streaming";
    return "ready";
  });
  const status = STATUS[phase];
  const label = t(`extensions.connectionStatus.${phase}`);

  return withTooltip(
    <div
      aria-label={t("extensions.connectionStatus.accessibleLabel", { status: label })}
      aria-live="polite"
      className="inline-flex h-6 w-1.5 shrink-0 items-center justify-center"
      title={label}
    >
      <span className={`size-1.5 rounded-full ${status.dot}`} />
    </div>,
    0,
  );
}
