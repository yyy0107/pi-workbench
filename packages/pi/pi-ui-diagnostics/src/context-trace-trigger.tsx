"use client";
import { diagnosticsUiTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";

import { ScanSearchIcon } from "lucide-react";

import {
  useActiveWorkspaceSurface,
  useRightWorkspace,
  useWorkspaceContext,
  useWorkspaceOpen,
} from "@workbench/ui-workspace/react";
import { DropdownMenuItem } from "@workbench/ui";

import type { ThreadMenuSlotContext } from "@workbench/extension-sdk";
import { useWorkbenchDomIds } from "@workbench/shell-context/dom";
import { usePiThreadStateSnapshot } from "@workbench/pi-client/context-trace";

import { CONTEXT_TRACE_SURFACE_KIND, revealContextTrace } from "./context-trace-workspace";

export function ContextTraceTrigger({ threadId: sessionId, closeMenu }: ThreadMenuSlotContext) {
  const { t } = useI18n(diagnosticsUiTranslationBundle);
  const controller = useRightWorkspace();
  const domIds = useWorkbenchDomIds();
  const context = useWorkspaceContext();
  const activeSurface = useActiveWorkspaceSurface();
  const workspaceOpen = useWorkspaceOpen();
  const { metadata } = usePiThreadStateSnapshot(sessionId);
  const contextTraceOpen =
    workspaceOpen &&
    activeSurface?.kind === CONTEXT_TRACE_SURFACE_KIND &&
    activeSurface.params.sessionId === sessionId;
  const label = t(
    contextTraceOpen ? "extensions.contextTrace.close" : "extensions.contextTrace.open",
  );

  return (
    <DropdownMenuItem
      className="gap-2.5 px-2.5"
      aria-controls={domIds.rightWorkspace}
      aria-expanded={contextTraceOpen}
      aria-label={label}
      title={label}
      onClick={() => {
        if (contextTraceOpen) {
          controller.setWorkspaceOpen(false);
        } else {
          revealContextTrace({ controller, context, sessionId });
        }
        closeMenu();
      }}
    >
      <span className="relative">
        <ScanSearchIcon aria-hidden="true" />
        {metadata.running ? (
          <span
            aria-hidden="true"
            className="border-background absolute -end-1 -top-1 size-2 rounded-full border bg-success"
          />
        ) : null}
      </span>
      {t("extensions.contextTrace.shortTitle")}
    </DropdownMenuItem>
  );
}
