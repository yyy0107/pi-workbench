"use client";

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
import { PiAgentRuntimeCopyProvider, type PiAgentRuntimeCopy } from "./copy";
import { beginPiSessionManagerLifecycle } from "./session-manager-lifecycle";
import { createPiAgentThreadStore, createPiWorkspaceFileSearchPort } from "./thread-store";
import { PiDraftWorkspaceTracker } from "./trackers";
import { PiWorkspaceSelectionProvider } from "./workspace-selection-provider";

export type PiSessionManagerFactory = (
  options: Readonly<PiSessionManagerOptions>,
) => PiSessionManager;

function PiRuntimeEnvironmentHost({
  children,
  manager,
}: Readonly<{ children: ReactNode; manager: PiSessionManager }>) {
  const current = useCurrentSession();
  const commands = usePiAgentCommandCatalog(manager);
  const threadStore = useMemo(() => createPiAgentThreadStore(manager), [manager]);
  const workspaceFiles = useMemo(() => createPiWorkspaceFileSearchPort(manager), [manager]);
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
      threadStore={threadStore}
      workspaceFiles={workspaceFiles}
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
}: Readonly<{
  children: ReactNode;
  copy: PiAgentRuntimeCopy;
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
        <PiWorkspaceSelectionProvider directoryStore={workspaceDirectoryStore}>
          <RuntimeProvider runtime={manager}>
            <PiDraftWorkspaceTracker manager={manager} />
            <PiRuntimeEnvironmentHost manager={manager}>{children}</PiRuntimeEnvironmentHost>
          </RuntimeProvider>
        </PiWorkspaceSelectionProvider>
      </PiSessionManagerProvider>
    </PiAgentRuntimeCopyProvider>
  );
}
