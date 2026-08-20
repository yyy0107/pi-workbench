"use client";

import { useEffect, useMemo } from "react";

import {
  useRightWorkspace,
  useRightWorkspaceState,
  useWorkspaceContext,
} from "@/components/right-workspace";
import { useI18n } from "@/i18n";

import { isTerminalTranscriptTarget, useTerminalLaunchContext } from "./terminal-target";
import { terminalWorkspaceService } from "./terminal-workspace-service";

export function TerminalRuntimeBridge() {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const launch = useTerminalLaunchContext();
  const workspaceOpen = useRightWorkspaceState((state) => state.open);
  const surfaceOrder = useRightWorkspaceState((state) => state.surfaceOrder);
  const surfacesById = useRightWorkspaceState((state) => state.surfaces);
  const legacyTerminals = useMemo(
    () =>
      surfaceOrder.flatMap((surfaceId) => {
        const surface = surfacesById[surfaceId];
        const legacy =
          surface?.kind === "terminal" &&
          !isTerminalTranscriptTarget(surface.params) &&
          (typeof surface.params.threadId !== "string" ||
            surface.params.threadId === "application" ||
            (surface.scope.type === "thread" &&
              surface.scope.key === launch.threadId &&
              surface.params.threadId !== launch.threadId));
        return legacy ? [{ id: surfaceId, params: surface.params }] : [];
      }),
    [surfaceOrder, surfacesById],
  );
  const activeTerminal = useRightWorkspaceState((state) => {
    const active = state.activeSurfaceId ? state.surfaces[state.activeSurfaceId] : undefined;
    return active?.kind === "terminal" && !isTerminalTranscriptTarget(active.params);
  });

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

  useEffect(
    () =>
      terminalWorkspaceService.attach({
        controller,
        context,
        launch,
        title: t("extensions.terminal.title"),
        activeTerminal,
        workspaceOpen,
      }),
    [activeTerminal, context, controller, launch, t, workspaceOpen],
  );

  return null;
}
