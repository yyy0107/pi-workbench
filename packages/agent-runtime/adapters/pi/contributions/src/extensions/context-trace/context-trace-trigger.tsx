"use client";

import { ScanSearchIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import {
  useActiveWorkspaceSurface,
  useRightWorkspace,
  useWorkspaceContext,
  useWorkspaceOpen,
} from "@workbench/shell/right-workspace/react";
import { Button } from "@workbench/shell/ui";
import { usePiI18n } from "../../i18n";
import { useMainViewService } from "@workbench/extension-host";
import { useWorkbenchDomIds } from "@workbench/shell/dom";
import {
  usePiActiveSessionId,
  usePiThreadStateSnapshot,
} from "@workbench/agent-runtime-pi-client/context-trace";

import { CONTEXT_TRACE_SURFACE_KIND, revealContextTrace } from "./context-trace-workspace";

export function ContextTraceTrigger() {
  const { t } = usePiI18n();
  const mainViews = useMainViewService();
  const activeMainView = useSyncExternalStore(
    mainViews.subscribe,
    mainViews.getSnapshot,
    mainViews.getInitialSnapshot,
  );
  const controller = useRightWorkspace();
  const domIds = useWorkbenchDomIds();
  const context = useWorkspaceContext();
  const activeSurface = useActiveWorkspaceSurface();
  const workspaceOpen = useWorkspaceOpen();
  const sessionId = usePiActiveSessionId();
  const { metadata } = usePiThreadStateSnapshot(sessionId);
  const contextTraceOpen =
    workspaceOpen &&
    activeSurface?.kind === CONTEXT_TRACE_SURFACE_KIND &&
    activeSurface.params.sessionId === sessionId;
  const label = t(
    contextTraceOpen ? "extensions.contextTrace.close" : "extensions.contextTrace.open",
  );

  if (activeMainView) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={!sessionId}
      aria-controls={domIds.rightWorkspace}
      aria-expanded={contextTraceOpen}
      aria-label={label}
      title={label}
      onClick={() => {
        if (!sessionId) return;
        if (contextTraceOpen) {
          controller.setWorkspaceOpen(false);
          return;
        }
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
      <span className="hidden sm:inline">{t("extensions.contextTrace.shortTitle")}</span>
    </Button>
  );
}
