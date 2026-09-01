"use client";

import { useEffect, useMemo } from "react";

import {
  useActiveWorkspaceSurface,
  useRightWorkspace,
  useWorkspaceContext,
  useWorkspaceOpen,
  useWorkspaceSurfaces,
} from "@workbench/shell/right-workspace/react";

import { isTerminalTranscriptTarget, useTerminalLaunchContext } from "./terminal-target";
import { loadTerminalSurface } from "./terminal-surface-loader";
import { useInstalledTerminalWorkspaceService } from "./open-terminal-command";
import { TERMINAL_SURFACE_TITLE } from "./terminal-workspace-service";

export function TerminalRuntimeBridge() {
  const terminalWorkspaceService = useInstalledTerminalWorkspaceService();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const launch = useTerminalLaunchContext();
  const workspaceOpen = useWorkspaceOpen();
  const terminalSurfaces = useWorkspaceSurfaces("terminal");
  const legacyTerminals = useMemo(
    () =>
      terminalSurfaces.flatMap((surface) => {
        const legacy =
          !isTerminalTranscriptTarget(surface.params) &&
          (typeof surface.params.threadId !== "string" ||
            surface.params.threadId === "application" ||
            (surface.scope.type === "thread" &&
              surface.scope.key === launch.threadId &&
              surface.params.threadId !== launch.threadId));
        return legacy ? [{ id: surface.id, params: surface.params }] : [];
      }),
    [terminalSurfaces],
  );
  const activeSurface = useActiveWorkspaceSurface();
  const activeTerminal =
    activeSurface?.kind === "terminal" && !isTerminalTranscriptTarget(activeSurface.params);

  useEffect(() => {
    void loadTerminalSurface().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (launch.threadId === "application") return;
    for (const terminal of legacyTerminals) {
      const sessionId =
        typeof terminal.params.sessionId === "string" ? terminal.params.sessionId : undefined;
      controller.update(terminal.id, {
        scope: { type: "thread", key: launch.threadId },
        params: {
          ...terminal.params,
          threadId: launch.threadId,
          ...(typeof terminal.params.terminalId === "string"
            ? {}
            : { terminalId: sessionId ?? terminal.id }),
        },
      });
    }
  }, [controller, launch.threadId, legacyTerminals]);

  useEffect(() => {
    if (!terminalWorkspaceService) return;
    return terminalWorkspaceService.attach({
      controller,
      context,
      launch,
      title: TERMINAL_SURFACE_TITLE,
      activeTerminal,
      workspaceOpen,
    });
  }, [activeTerminal, context, controller, launch, terminalWorkspaceService, workspaceOpen]);

  return null;
}
