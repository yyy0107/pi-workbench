"use client";

import { AssistantRuntimeProvider, useAui } from "@assistant-ui/react";
import { useMemo, type ReactNode } from "react";

import type { WorkbenchAgentWorkspace } from "@/runtime/assistant-ui/agent-runtime-adapter";
import { WorkbenchAgentRuntimeEnvironmentProvider } from "@/runtime/assistant-ui/agent-runtime-context";

import { usePiSessionManager } from "../runtime/context";
import { createPiAgentRuntimeAdapter } from "./adapter";
import { useBoundPiAgentCommandCatalog } from "./command-catalog";
import { useBoundPiThreadRuntime } from "./thread-runtime";

/**
 * Install a nested assistant-ui Runtime bound to one Pi session without changing the global
 * thread-list selection. The parent client is explicitly inherited so extension-owned scopes and
 * renderer registrations remain available inside the nested conversation.
 */
export function PiBoundThreadRuntimeProvider({
  sessionId,
  workspace,
  children,
}: Readonly<{
  sessionId: string;
  workspace?: WorkbenchAgentWorkspace;
  children: ReactNode;
}>) {
  const manager = usePiSessionManager();
  const parentAui = useAui();
  const runtime = useBoundPiThreadRuntime(manager, sessionId, { workspace });
  const commands = useBoundPiAgentCommandCatalog(manager, sessionId);
  const adapter = useMemo(() => createPiAgentRuntimeAdapter(manager), [manager]);

  return (
    <AssistantRuntimeProvider runtime={runtime} aui={parentAui}>
      <WorkbenchAgentRuntimeEnvironmentProvider
        adapter={adapter}
        threadId={sessionId}
        commands={commands}
      >
        {children}
      </WorkbenchAgentRuntimeEnvironmentProvider>
    </AssistantRuntimeProvider>
  );
}
