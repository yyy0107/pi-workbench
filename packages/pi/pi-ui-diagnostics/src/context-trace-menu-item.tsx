"use client";
import { diagnosticsUiTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";

import { ScanSearchIcon } from "lucide-react";

import { useRightWorkspace, useWorkspaceContext } from "@workbench/ui-workspace/react";
import { Button } from "@workbench/ui";

import type { WorkspaceSurfaceMenuItemProps } from "@workbench/extension-sdk";
import { usePiActiveSessionId } from "@workbench/pi-client/context-trace";

import { revealContextTrace } from "./context-trace-workspace";

export function ContextTraceMenuItem({ closeMenu }: WorkspaceSurfaceMenuItemProps) {
  const { t } = useI18n(diagnosticsUiTranslationBundle);
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
