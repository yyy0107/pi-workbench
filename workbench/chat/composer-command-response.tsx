"use client";

import { CircleCheckIcon, CircleXIcon, LoaderCircleIcon } from "lucide-react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { WorkbenchComposerCommandResponseDetails } from "@/runtime/composer-request";

export function WorkbenchComposerCommandResponse({
  response,
}: {
  response: WorkbenchComposerCommandResponseDetails;
}) {
  const { t } = useI18n();
  const running = response.status === "running";
  const failed = response.status === "execution-failed";
  const message =
    response.commandId === "compact"
      ? running
        ? t("workbench.chat.commandResponses.compactRunning")
        : failed
          ? t("workbench.chat.commandResponses.compactFailed")
          : t("workbench.chat.commandResponses.compactSucceeded")
      : response.commandId === "reload"
        ? running
          ? t("workbench.chat.commandResponses.reloadRunning")
          : failed
            ? t("workbench.chat.commandResponses.reloadFailed")
            : t("workbench.chat.commandResponses.reloadSucceeded")
        : running
          ? t("workbench.chat.commandResponses.commandRunning", { command: response.label })
          : failed
            ? t("workbench.chat.commandResponses.commandFailed", { command: response.label })
            : t("workbench.chat.commandResponses.commandSucceeded", { command: response.label });
  const Icon = running ? LoaderCircleIcon : failed ? CircleXIcon : CircleCheckIcon;

  return (
    <div
      role={failed ? "alert" : "status"}
      aria-live={failed ? "assertive" : "polite"}
      data-command={response.commandId}
      data-status={response.status}
      data-workbench-glass-surface=""
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        failed
          ? "border-destructive/25 bg-destructive/5 text-destructive"
          : "border-border bg-muted/50 text-muted-foreground",
      )}
    >
      <Icon
        className={cn("mt-0.5 size-4 shrink-0", running && "animate-spin")}
        aria-hidden="true"
      />
      <span>{message}</span>
    </div>
  );
}
