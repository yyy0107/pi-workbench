"use client";

import { AssistantRuntimeProvider, useAuiState } from "@assistant-ui/react";
import type { ReactNode } from "react";

import type { WorkbenchAgentRuntimeAdapter } from "./agent-runtime-adapter";
import { WorkbenchAgentRuntimeEnvironmentProvider } from "./agent-runtime-context";
import { useWorkbenchRuntime } from "./use-workbench-runtime";

function WorkbenchAgentRuntimeEnvironmentHost({
  adapter,
  children,
}: Readonly<{ adapter: WorkbenchAgentRuntimeAdapter; children: ReactNode }>) {
  const commands = adapter.useCommandCatalog();
  const threadId = useAuiState((state) => {
    const mainThreadId = state.threads.mainThreadId;
    const mainThread = state.threads.threadItems.find((thread) => thread.id === mainThreadId);
    return mainThread?.remoteId ?? mainThread?.externalId ?? mainThreadId;
  });
  return (
    <WorkbenchAgentRuntimeEnvironmentProvider
      adapter={adapter}
      threadId={threadId}
      commands={commands}
    >
      {children}
    </WorkbenchAgentRuntimeEnvironmentProvider>
  );
}

/**
 * Backend-neutral assistant-ui host.
 *
 * Concrete Agent Runtime implementations own their manager, transport, and adapter lifecycle;
 * this component only installs the selected adapter into assistant-ui's provider tree.
 */
export function WorkbenchAgentRuntimeHost({
  adapter,
  children,
}: Readonly<{ adapter: WorkbenchAgentRuntimeAdapter; children: ReactNode }>) {
  const runtime = useWorkbenchRuntime(adapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <WorkbenchAgentRuntimeEnvironmentHost key={adapter.id} adapter={adapter}>
        {children}
      </WorkbenchAgentRuntimeEnvironmentHost>
    </AssistantRuntimeProvider>
  );
}
