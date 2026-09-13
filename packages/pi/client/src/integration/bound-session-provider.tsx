"use client";

import type { WorkbenchServicesCapabilities } from "@workbench/agent-runtime-client/capabilities";
import { createWorkspaceFileSearchPort } from "@workbench/services-client/workspace";

import { useEffect, useMemo, type ReactNode } from "react";

import { SessionProvider } from "@workbench/agent-runtime-client";
import { WorkbenchAgentRuntimeEnvironmentProvider } from "@workbench/agent-runtime-client/context";
import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@workbench/agent-runtime-pi-shared/descriptor";

import { usePiSessionManager } from "../runtime/context";
import { useBoundPiAgentCommandCatalog } from "./command-catalog";
import { createPiAgentRuntimeCapabilities } from "./capabilities";
import { createPiAgentThreadStore } from "./thread-store";

/** Bind a nested conversation to one Pi session without changing global selection. */
export function PiBoundSessionProvider({
  sessionId,
  children,
  services,
}: Readonly<{ sessionId: string; children: ReactNode; services: WorkbenchServicesCapabilities }>) {
  const manager = usePiSessionManager();
  const session = manager.session(sessionId);
  const sessionBinding = useMemo(() => createPiSessionBinding(services), [services]);
  const commands = useBoundPiAgentCommandCatalog(manager, sessionId);
  const capabilities = useMemo(
    () => createPiAgentRuntimeCapabilities(manager, services),
    [manager, services],
  );
  const threadStore = useMemo(() => createPiAgentThreadStore(manager), [manager]);
  const workspaceFiles = useMemo(
    () => createWorkspaceFileSearchPort(services.workspace),
    [services.workspace],
  );

  useEffect(() => {
    if (!session) return;
    void session
      .open()
      .catch((error) => console.error("[workbench-pi] failed to open bound session", error));
  }, [session]);

  return (
    <SessionProvider sessionId={sessionId}>
      <WorkbenchAgentRuntimeEnvironmentProvider
        id={PI_AGENT_RUNTIME_DESCRIPTOR.id}
        threadId={sessionId}
        commands={commands}
        capabilities={capabilities}
        threadStore={threadStore}
        workspaceFiles={workspaceFiles}
        sessionBinding={sessionBinding}
      >
        {children}
      </WorkbenchAgentRuntimeEnvironmentProvider>
    </SessionProvider>
  );
}

export function createPiSessionBinding(services: WorkbenchServicesCapabilities) {
  return function PiSessionBinding(props: Readonly<{ sessionId: string; children: ReactNode }>) {
    return <PiBoundSessionProvider {...props} services={services} />;
  };
}
