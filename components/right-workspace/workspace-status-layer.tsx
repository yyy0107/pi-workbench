"use client";

import {
  AlertCircleIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  WifiOffIcon,
} from "lucide-react";

import { useI18n } from "@/i18n";

import type { WorkspaceSurfaceInstance } from "./core/surface-types";

export function WorkspaceStatusLayer({
  surface,
  onRetry,
}: Readonly<{ surface: WorkspaceSurfaceInstance; onRetry(): void }>) {
  const { t } = useI18n();

  if (surface.status === "idle" || surface.status === "ready") return null;

  const state = {
    loading: {
      icon: LoaderCircleIcon,
      message: t("rightWorkspace.status.loading"),
      className: "animate-spin",
    },
    disconnected: {
      icon: WifiOffIcon,
      message: t("rightWorkspace.status.disconnected"),
      className: "",
    },
    "permission-required": {
      icon: ShieldAlertIcon,
      message: t("rightWorkspace.status.permissionRequired"),
      className: "",
    },
    "resource-changed": {
      icon: RefreshCwIcon,
      message: t("rightWorkspace.status.resourceChanged"),
      className: "",
    },
    error: {
      icon: AlertCircleIcon,
      message: t("rightWorkspace.status.error"),
      className: "",
    },
  }[surface.status];

  if (!state) return null;
  const Icon = state.icon;
  const blocking = surface.status !== "resource-changed";

  return (
    <div
      role={surface.status === "loading" ? "status" : "alert"}
      className={
        blocking
          ? "bg-background/92 absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 p-8 text-center backdrop-blur-sm"
          : "bg-background/95 absolute inset-x-2 top-2 z-20 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs shadow-sm"
      }
    >
      <Icon className={`size-4 shrink-0 ${state.className}`} />
      <p className={blocking ? "text-muted-foreground text-sm" : "min-w-0 flex-1"}>
        {state.message}
      </p>
      {surface.statusMessage ? (
        <p className="text-foreground/75 max-w-lg break-words text-xs">{surface.statusMessage}</p>
      ) : null}
      {surface.status !== "loading" ? (
        <button
          type="button"
          className="hover:bg-muted h-7 rounded-lg border px-2.5 text-xs"
          onClick={onRetry}
        >
          {t("rightWorkspace.status.retry")}
        </button>
      ) : null}
    </div>
  );
}
