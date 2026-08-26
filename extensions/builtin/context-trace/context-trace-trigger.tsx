"use client";

import { ScanSearchIcon } from "lucide-react";

import { useRightWorkspace, useWorkspaceContext } from "@/components/right-workspace";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import {
  usePiActiveSessionId,
  usePiThreadStateSnapshot,
} from "@/runtime/pi/client/runtime/context";

import { revealContextTrace } from "./context-trace-workspace";

export function ContextTraceTrigger() {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const sessionId = usePiActiveSessionId();
  const { metadata } = usePiThreadStateSnapshot(sessionId);
  const label = t("extensions.contextTrace.open");

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={!sessionId}
      aria-label={label}
      title={label}
      onClick={() => {
        if (!sessionId) return;
        revealContextTrace({ controller, context, sessionId });
      }}
    >
      <span className="relative">
        <ScanSearchIcon className="size-3.5" />
        {metadata.running ? (
          <span
            aria-hidden="true"
            className="border-background absolute -end-1 -top-1 size-2 rounded-full border bg-emerald-500"
          />
        ) : null}
      </span>
      <span>{t("extensions.contextTrace.shortTitle")}</span>
    </Button>
  );
}
