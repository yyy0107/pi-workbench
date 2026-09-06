"use client";

import { usePiI18n } from "../../i18n";
import { usePiHostDescription } from "@workbench/agent-runtime-pi-client/host";
import { useWorkbenchBranding } from "@workbench/shell/presentation";

import { ConnectionStatus } from "./connection-status";
import { withTooltip } from "@workbench/shell/ui";

export function PiVersion() {
  const { t } = usePiI18n();
  const { productLogoUrl, productName } = useWorkbenchBranding();
  const version = usePiHostDescription()?.version;
  const description = version
    ? t("extensions.connectionStatus.workbenchVersionDescription", { productName, version })
    : t("extensions.connectionStatus.workbenchVersionLoading", { productName });

  return (
    <div className="@min-[480px]/statusbar:min-w-[16ch] inline-flex h-6 min-w-0 items-center justify-start gap-1.5 rounded-md pr-1.5 pl-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
      {withTooltip(
        <div
          aria-label={description}
          aria-live="polite"
          className="inline-flex items-center gap-1.5"
          title={description}
        >
          {productLogoUrl ? (
            <img
              src={productLogoUrl}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="size-4 shrink-0 dark:invert"
            />
          ) : null}
          <span className="@max-[340px]/statusbar:hidden">
            {productName} v{version ?? "—"}
          </span>
        </div>,
      )}
      <ConnectionStatus />
    </div>
  );
}
