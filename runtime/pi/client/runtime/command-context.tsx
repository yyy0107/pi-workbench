"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import type { CommandView } from "../../rpc-contracts";
import { listPiCommands } from "../transport/api";
import { usePiActiveSessionId } from "./context";

const EMPTY_COMMANDS: readonly CommandView[] = [];
const PiCommandsContext = createContext<readonly CommandView[] | null>(null);

export function PiCommandsProvider({ children }: Readonly<{ children: ReactNode }>) {
  const sessionId = usePiActiveSessionId();
  const [commandState, setCommandState] = useState<{
    sessionId: string;
    commands: readonly CommandView[];
  }>();

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    void listPiCommands({ sessionId })
      .then(({ commands }) => {
        if (!cancelled) setCommandState({ sessionId, commands });
      })
      .catch((error) => {
        if (!cancelled) console.error("[workbench-pi] failed to load session commands", error);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const commands =
    commandState && commandState.sessionId === sessionId ? commandState.commands : EMPTY_COMMANDS;

  return <PiCommandsContext.Provider value={commands}>{children}</PiCommandsContext.Provider>;
}

export function usePiCommands(): readonly CommandView[] {
  const commands = useContext(PiCommandsContext);
  if (!commands) throw new Error("PiCommandsProvider is missing");
  return commands;
}
