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
import { useRightWorkspace } from "./workspace-context";

export function WorkspaceStatusLayer({ surface }: Readonly<{ surface: WorkspaceSurfaceInstance }>) {
  const { t } = useI18n();
  const controller = useRightWorkspace();

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
      {surface.status !== "loading" ? (
        <button
          type="button"
          className="hover:bg-muted h-7 rounded-lg border px-2.5 text-xs"
          onClick={() =>
            controller.update(surface.id, { status: "ready", statusMessage: undefined })
          }
        >
          {t("rightWorkspace.status.retry")}
        </button>
      ) : null}
    </div>
  );
}
