"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import type { ReactNode } from "react";

import type { WorkbenchAgentRuntimeAdapter } from "./agent-runtime-adapter";
import { WorkbenchAgentRuntimeEnvironmentProvider } from "./agent-runtime-context";
import { useWorkbenchRuntime } from "./use-workbench-runtime";

function WorkbenchAgentRuntimeEnvironmentHost({
  adapter,
  children,
}: Readonly<{ adapter: WorkbenchAgentRuntimeAdapter; children: ReactNode }>) {
  const commands = adapter.useCommandCatalog();
  return (
    <WorkbenchAgentRuntimeEnvironmentProvider adapter={adapter} commands={commands}>
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
