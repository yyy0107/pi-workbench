"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  EMPTY_WORKBENCH_AGENT_COMMANDS,
  type WorkbenchAgentCommand,
} from "@/runtime/shared/agent-command/catalog";
import type { CommandListPayload } from "@/runtime/pi/contracts/rpc";
import {
  projectPiAgentCommand,
  projectPiAgentCommands,
} from "@/runtime/pi/shared/commands/command-projection";
import { useWorkspaceSelection } from "@/services/workspace-selection-service";

import type { PiSessionManager } from "../runtime/manager";
import {
  getPiResourceCatalogRevision,
  subscribePiResourceCatalog,
} from "../runtime/resource-catalog-revision";
import { listPiCommands } from "../transport/api";

export function resolvePiCommandListPayload(
  sessionId: string | undefined,
  workspaceId: string | undefined,
): CommandListPayload {
  if (sessionId) return { sessionId };
  if (workspaceId) return { target: { scope: "project", workspaceId } };
  return { target: { scope: "user" } };
}

export { projectPiAgentCommand, projectPiAgentCommands };

function usePiAgentCommandCatalogTarget(
  manager: PiSessionManager,
  sessionId: string | undefined,
  workspaceId: string | undefined,
): readonly WorkbenchAgentCommand[] {
  const requestKey = sessionId
    ? `session:${sessionId}`
    : workspaceId
      ? `project:${workspaceId}`
      : "user";
  const resourceCatalogRevision = useSyncExternalStore(
    subscribePiResourceCatalog,
    getPiResourceCatalogRevision,
    () => 0,
  );
  const [commandState, setCommandState] = useState<{
    readonly manager: PiSessionManager;
    readonly requestKey: string;
    readonly commands: readonly WorkbenchAgentCommand[];
  }>();

  useEffect(() => {
    let cancelled = false;
    setCommandState(undefined);

    void listPiCommands(resolvePiCommandListPayload(sessionId, workspaceId))
      .then(({ commands }) => {
        if (!cancelled) {
          setCommandState({
            manager,
            requestKey,
            commands: projectPiAgentCommands(commands),
          });
        }
      })
      .catch((error) => {
        if (!cancelled) console.error("[workbench-pi] failed to load composer commands", error);
      });

    return () => {
      cancelled = true;
    };
  }, [manager, requestKey, resourceCatalogRevision, sessionId, workspaceId]);

  return commandState?.manager === manager && commandState.requestKey === requestKey
    ? commandState.commands
    : EMPTY_WORKBENCH_AGENT_COMMANDS;
}

/** Commands for an explicit Runtime-bound Pi session, including hidden scratch sessions. */
export function useBoundPiAgentCommandCatalog(
  manager: PiSessionManager,
  sessionId: string,
): readonly WorkbenchAgentCommand[] {
  return usePiAgentCommandCatalogTarget(manager, sessionId, undefined);
}

/** Pi implementation of the backend-neutral command catalog capability. */
export function usePiAgentCommandCatalog(
  manager: PiSessionManager,
): readonly WorkbenchAgentCommand[] {
  const sessionId = useSyncExternalStore(
    manager.subscribeActiveSession,
    manager.getActiveSessionId,
    manager.getActiveSessionId,
  );
  const { activeWorkspaceId, draftWorkspaceId } = useWorkspaceSelection();
  const workspaceId = draftWorkspaceId ?? activeWorkspaceId;
  return usePiAgentCommandCatalogTarget(manager, sessionId, workspaceId);
}
