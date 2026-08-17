"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AssistantRuntimeProvider, useAuiState } from "@assistant-ui/react";

import { PiSessionManagerProvider } from "@/runtime/pi/client/context";
import { PiSessionManager } from "@/runtime/pi/client/manager";
import { useWorkbenchRuntime } from "@/runtime/use-workbench-runtime";
import { useWorkspaceDirectoryStore } from "@/workbench/workspaces/workspace-directory-store";

function ActivePiThreadTracker({ manager }: { manager: PiSessionManager }) {
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const mainThread = useAuiState((state) =>
    state.threads.threadItems.find((thread) => thread.id === state.threads.mainThreadId),
  );
  const syncDirectory = useWorkspaceDirectoryStore((state) => state.syncDirectory);
  const revealDirectory = useWorkspaceDirectoryStore((state) => state.revealDirectory);

  useEffect(() => {
    manager.setActive(mainThreadId, mainThread?.remoteId);
  }, [mainThread?.remoteId, mainThreadId, manager]);

  useEffect(() => {
    const id = mainThread?.custom?.piWorkspaceId;
    const name = mainThread?.custom?.piWorkspaceName;
    const cwd = mainThread?.custom?.piWorkspaceCwd;
    if (typeof id !== "string" || typeof name !== "string" || typeof cwd !== "string") return;
    syncDirectory({ id, name, cwd });
    revealDirectory(id);
  }, [mainThread?.custom, revealDirectory, syncDirectory]);

  return null;
}

function PiDraftWorkspaceTracker({ manager }: { manager: PiSessionManager }) {
  const newThreadId = useAuiState((state) => state.threads.newThreadId);
  const draftWorkspace = useWorkspaceDirectoryStore((state) =>
    state.directories.find((directory) => directory.id === state.draftDirectoryId),
  );

  useEffect(() => {
    if (!newThreadId) return;
    manager.setDraftWorkspace(newThreadId, draftWorkspace);
    return () => manager.setDraftWorkspace(newThreadId, undefined);
  }, [draftWorkspace, manager, newThreadId]);

  return null;
}

export function WorkbenchAssistantRuntimeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const managerRef = useRef<PiSessionManager | null>(null);
  if (!managerRef.current) managerRef.current = new PiSessionManager();
  const manager = managerRef.current;
  const runtime = useWorkbenchRuntime(manager);

  useEffect(() => {
    void manager
      .start()
      .catch((error) => console.error("[workbench-pi] session manager failed to start", error));
    return () => manager.dispose();
  }, [manager]);

  return (
    <PiSessionManagerProvider manager={manager}>
      <AssistantRuntimeProvider runtime={runtime}>
        <ActivePiThreadTracker manager={manager} />
        <PiDraftWorkspaceTracker manager={manager} />
        {children}
      </AssistantRuntimeProvider>
    </PiSessionManagerProvider>
  );
}
