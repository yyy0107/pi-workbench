"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";

import { WorkbenchAgentRuntimeHost } from "@workbench/agent-runtime-client";
import type { PromptFeedbackPort } from "@workbench/agent-runtime-client/prompt-feedback";
import type { WorkbenchWorkspaceDirectoryStorePort } from "@workbench/agent-runtime-client/workspaces";

import { PiSessionManagerProvider } from "../runtime/context";
import { PiExecutionClientStateProvider } from "../public/execution";
import {
  PI_CLIENT_RUNTIME_IMPLEMENTATION_TOKEN,
  PiSessionManager,
  type PiSessionManagerOptions,
} from "../runtime/manager";
import { createPiAgentRuntimeAdapter } from "./adapter";
import { PiAgentRuntimeCopyProvider, type PiAgentRuntimeCopy } from "./copy";
import { beginPiSessionManagerLifecycle } from "./session-manager-lifecycle";
import { ActivePiThreadTracker, PiDraftWorkspaceTracker } from "./trackers";
import { PiWorkspaceSelectionProvider } from "./workspace-selection-provider";
import type { PiClientTransport } from "../transport/client-transport";

export type PiSessionManagerFactory = (
  options: Readonly<PiSessionManagerOptions>,
) => PiSessionManager;

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

  // Fast Refresh keeps refs alive even when the manager module is replaced. Recreate the manager
  // so existing sessions cannot retain an older class prototype without newly added RPC methods.
  managerRef.current = resolvePiSessionManager(managerRef.current, {
    promptFeedback,
    titleFallbacks,
    transport,
  });
  const manager = managerRef.current;
  const adapter = useMemo(() => createPiAgentRuntimeAdapter(manager), [manager]);

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
        <PiExecutionClientStateProvider>
          <PiWorkspaceSelectionProvider directoryStore={workspaceDirectoryStore}>
            <WorkbenchAgentRuntimeHost adapter={adapter}>
              <ActivePiThreadTracker manager={manager} />
              <PiDraftWorkspaceTracker manager={manager} />
              {children}
            </WorkbenchAgentRuntimeHost>
          </PiWorkspaceSelectionProvider>
        </PiExecutionClientStateProvider>
      </PiSessionManagerProvider>
    </PiAgentRuntimeCopyProvider>
  );
}
