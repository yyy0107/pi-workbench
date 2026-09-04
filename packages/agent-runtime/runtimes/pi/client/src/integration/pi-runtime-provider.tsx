"use client";

import type { WorkbenchServicesCapabilities } from "@workbench/agent-runtime-client/capabilities";
import { createWorkspaceFileSearchPort } from "@workbench/services-client/workspace";

import { useEffect, useMemo, useRef, type ReactNode } from "react";

import { RuntimeProvider, useCurrentSession } from "@workbench/agent-runtime-client";
import { WorkbenchAgentRuntimeEnvironmentProvider } from "@workbench/agent-runtime-client/context";
import type { PromptFeedbackPort } from "@workbench/agent-runtime-client/prompt-feedback";
import type { WorkbenchWorkspaceDirectoryStorePort } from "@workbench/agent-runtime-client/workspaces";
import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@workbench/agent-runtime-pi-shared/descriptor";

import { PiSessionManagerProvider } from "../runtime/context";
import {
  PI_CLIENT_RUNTIME_IMPLEMENTATION_TOKEN,
  PiSessionManager,
  type PiSessionManagerOptions,
} from "../runtime/manager";
import type { PiClientTransport } from "../transport/client-transport";
import { usePiAgentCommandCatalog } from "./command-catalog";
import { createPiSessionBinding } from "./bound-session-provider";
import { createPiAgentRuntimeCapabilities } from "./capabilities";
import { PiAgentRuntimeCopyProvider, type PiAgentRuntimeCopy } from "./copy";
import { beginPiSessionManagerLifecycle } from "./session-manager-lifecycle";
import { createPiAgentThreadStore } from "./thread-store";
import { PiDraftWorkspaceTracker } from "./trackers";
import { PiWorkspaceSelectionProvider } from "./workspace-selection-provider";

export type PiSessionManagerFactory = (
  options: Readonly<PiSessionManagerOptions>,
) => PiSessionManager;

function PiRuntimeEnvironmentHost({
  children,
  manager,
  services,
}: Readonly<{
  children: ReactNode;
  manager: PiSessionManager;
  services: WorkbenchServicesCapabilities;
}>) {
  const current = useCurrentSession();
  const commands = usePiAgentCommandCatalog(manager);
  const sessionBinding = useMemo(() => createPiSessionBinding(services), [services]);
  const capabilities = useMemo(
    () => createPiAgentRuntimeCapabilities(manager, services),
    [manager, services],
  );
  const threadStore = useMemo(() => createPiAgentThreadStore(manager), [manager]);
  const workspaceFiles = useMemo(
    () => createWorkspaceFileSearchPort(services.workspace),
    [services.workspace],
  );
  const session = current.sessionId ? manager.session(current.sessionId) : undefined;

  useEffect(() => {
    if (!session) return;
    void session
      .open()
      .catch((error) => console.error("[workbench-pi] failed to open current session", error));
  }, [session]);

  return (
    <WorkbenchAgentRuntimeEnvironmentProvider
      id={PI_AGENT_RUNTIME_DESCRIPTOR.id}
      threadId={current.threadId ?? current.sessionId}
      commands={commands}
      capabilities={capabilities}
      threadStore={threadStore}
      workspaceFiles={workspaceFiles}
      sessionBinding={sessionBinding}
    >
      {children}
    </WorkbenchAgentRuntimeEnvironmentProvider>
  );
}

/** Resolve the Provider's singular manager while retaining the Fast Refresh replacement guard. */
export function resolvePiSessionManager(
  current: PiSessionManager | null,
  options: Readonly<PiSessionManagerOptions>,
  factory: PiSessionManagerFactory = (managerOptions) => new PiSessionManager(managerOptions),
): PiSessionManager {
  if (current?.implementationToken === PI_CLIENT_RUNTIME_IMPLEMENTATION_TOKEN) return current;
  return factory(options);
}

/** Complete Pi installation behind the generic Workbench Agent Runtime host. */
export function PiAgentRuntimeProvider({
  children,
  copy,
  promptFeedback,
  transport,
  workspaceDirectoryStore,
  services,
}: Readonly<{
  children: ReactNode;
  copy: PiAgentRuntimeCopy;
  services: WorkbenchServicesCapabilities;
  promptFeedback?: PromptFeedbackPort;
  transport?: PiClientTransport;
  workspaceDirectoryStore: WorkbenchWorkspaceDirectoryStorePort;
}>) {
  const titleFallbacks = copy.titles;
  const managerRef = useRef<PiSessionManager | null>(null);
  const managerLifecycleRef = useRef(0);

  managerRef.current = resolvePiSessionManager(managerRef.current, {
    promptFeedback,
    titleFallbacks,
    settings: services.settings,
    transport,
  });
  const manager = managerRef.current;

  useEffect(() => manager.setTitleFallbacks(titleFallbacks), [manager, titleFallbacks]);
  useEffect(
    () =>
      beginPiSessionManagerLifecycle(manager, managerRef, managerLifecycleRef, (error) =>
        console.error("[workbench-pi] session manager failed to start", error),
      ),
    [manager],
  );

  return (
    <PiAgentRuntimeCopyProvider copy={copy}>
      <PiSessionManagerProvider manager={manager}>
        <PiWorkspaceSelectionProvider directoryStore={workspaceDirectoryStore} host={services.host}>
          <RuntimeProvider runtime={manager}>
            <PiDraftWorkspaceTracker manager={manager} />
            <PiRuntimeEnvironmentHost manager={manager} services={services}>
              {children}
            </PiRuntimeEnvironmentHost>
          </RuntimeProvider>
        </PiWorkspaceSelectionProvider>
      </PiSessionManagerProvider>
    </PiAgentRuntimeCopyProvider>
  );
}
