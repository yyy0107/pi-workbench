"use client";

import { useI18n } from "@/i18n";
import { usePiHostDescription } from "@/runtime/pi/client/runtime/context";

import { ConnectionStatus } from "./connection-status";

export function PiVersion() {
  const { t } = useI18n();
  const version = usePiHostDescription()?.piVersion;
  const description = version
    ? t("extensions.connectionStatus.piVersionDescription", { version })
    : t("extensions.connectionStatus.piVersionLoading");

  return (
    <div className="@min-[480px]/statusbar:min-w-[16ch] inline-flex h-6 min-w-0 items-center justify-start gap-1.5 rounded-md pr-1.5 pl-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
      <div
        aria-label={description}
        aria-live="polite"
        className="inline-flex items-center gap-1.5"
        title={description}
      >
        <img
          src="/pi-logo-on-light.svg"
          alt=""
          aria-hidden="true"
          draggable={false}
          className="size-4 shrink-0 dark:invert"
        />
        <span className="@max-[340px]/statusbar:hidden">Pi v{version ?? "—"}</span>
      </div>
      <ConnectionStatus />
    </div>
  );
}
