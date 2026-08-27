"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { useWorkspaceSelection } from "@/services/workspace-selection-service";

import type { CommandListPayload, CommandView } from "../../rpc-contracts";
import { listPiCommands } from "../transport/api";
import { usePiActiveSessionId } from "./context";
import {
  getPiResourceCatalogRevision,
  subscribePiResourceCatalog,
} from "./resource-catalog-revision";

const EMPTY_COMMANDS: readonly CommandView[] = [];
const PiCommandsContext = createContext<readonly CommandView[] | null>(null);

export function resolvePiCommandListPayload(
  sessionId: string | undefined,
  workspaceId: string | undefined,
): CommandListPayload {
  if (sessionId) return { sessionId };
  if (workspaceId) return { target: { scope: "project", workspaceId } };
  return { target: { scope: "user" } };
}

export function PiCommandsProvider({ children }: Readonly<{ children: ReactNode }>) {
  const sessionId = usePiActiveSessionId();
  const { activeWorkspaceId, draftWorkspaceId } = useWorkspaceSelection();
  const workspaceId = draftWorkspaceId ?? activeWorkspaceId;
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
    requestKey: string;
    commands: readonly CommandView[];
  }>();

  useEffect(() => {
    let cancelled = false;
    setCommandState(undefined);
    const request = resolvePiCommandListPayload(sessionId, workspaceId);

    void listPiCommands(request)
      .then(({ commands }) => {
        if (!cancelled) setCommandState({ requestKey, commands });
      })
      .catch((error) => {
        if (!cancelled) console.error("[workbench-pi] failed to load composer commands", error);
      });

    return () => {
      cancelled = true;
    };
  }, [requestKey, resourceCatalogRevision, sessionId, workspaceId]);

  const commands = commandState?.requestKey === requestKey ? commandState.commands : EMPTY_COMMANDS;

  return <PiCommandsContext.Provider value={commands}>{children}</PiCommandsContext.Provider>;
}

export function usePiCommands(): readonly CommandView[] {
  const commands = useContext(PiCommandsContext);
  if (!commands) throw new Error("PiCommandsProvider is missing");
  return commands;
}
