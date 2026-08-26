"use client";

import { ScanSearchIcon } from "lucide-react";

import { useRightWorkspace, useWorkspaceContext } from "@/components/right-workspace";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { WorkspaceSurfaceMenuItemProps } from "@/platform/extensions";
import { usePiActiveSessionId } from "@/runtime/pi/client/runtime/context";

import { revealContextTrace } from "./context-trace-workspace";

export function ContextTraceMenuItem({ closeMenu }: WorkspaceSurfaceMenuItemProps) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const sessionId = usePiActiveSessionId();

  return (
    <Button
      type="button"
      variant="ghost"
      disabled={!sessionId}
      className="w-full justify-start font-normal"
      onClick={() => {
        if (!sessionId) return;
        revealContextTrace({ controller, context, sessionId });
        closeMenu();
      }}
    >
      <ScanSearchIcon className="text-muted-foreground size-4" />
      <span className="min-w-0 flex-1 truncate text-start">
        {t("extensions.contextTrace.title")}
      </span>
    </Button>
  );
}
