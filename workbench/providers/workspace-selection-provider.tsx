"use client";

import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";

import { usePiSessionManager, usePiWorkspaces } from "@/runtime/pi/client/runtime/context";
import {
  acceptCreatedWorkspaceAndBeginThread,
  resolveWorkspaceSelection,
  WorkspaceSelectionProvider,
  type WorkspaceCapabilities,
} from "@/services/workspace-selection-service";
import { useWorkspaceDirectoryStore } from "@/workbench/workspaces/workspace-directory-store";

export function WorkbenchWorkspaceSelectionProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const manager = usePiSessionManager();
  const workspaces = usePiWorkspaces();
  const activeWorkspaceId = useWorkspaceDirectoryStore((state) => state.activeDirectoryId);
  const draftWorkspaceId = useWorkspaceDirectoryStore((state) => state.draftDirectoryId);
  const collapsedWorkspaceIds = useWorkspaceDirectoryStore((state) => state.collapsedDirectoryIds);
  const reconcileWorkspaceIds = useWorkspaceDirectoryStore((state) => state.reconcileDirectoryIds);
  const activateWorkspace = useWorkspaceDirectoryStore((state) => state.activateDirectory);
  const deactivateWorkspace = useWorkspaceDirectoryStore((state) => state.deactivateDirectory);
  const revealWorkspace = useWorkspaceDirectoryStore((state) => state.revealDirectory);
  const toggleWorkspaceCollapsed = useWorkspaceDirectoryStore((state) => state.toggleDirectory);
  const beginNewThread = useWorkspaceDirectoryStore((state) => state.beginNewThread);
  const destroyNewThread = useWorkspaceDirectoryStore((state) => state.destroyNewThread);
  const discardWorkspace = useWorkspaceDirectoryStore((state) => state.discardDirectory);
  const knownWorkspaceIds = useRef<readonly string[] | undefined>(undefined);

  useLayoutEffect(() => {
    const workspaceIds = workspaces.map((workspace) => workspace.id);
    const previousIds = knownWorkspaceIds.current;
    if (
      previousIds &&
      previousIds.length === workspaceIds.length &&
      previousIds.every((id, index) => id === workspaceIds[index])
    ) {
      return;
    }

    const previousIdSet = new Set(previousIds ?? []);
    const newlyAddedIds = previousIds
      ? workspaceIds.filter((id) => !previousIdSet.has(id))
      : workspaceIds.slice(1);
    knownWorkspaceIds.current = workspaceIds;
    reconcileWorkspaceIds(workspaceIds, newlyAddedIds);
  }, [reconcileWorkspaceIds, workspaces]);

  const selection = useMemo(
    () =>
      resolveWorkspaceSelection(workspaces, {
        activeWorkspaceId,
        draftWorkspaceId,
        collapsedWorkspaceIds,
      }),
    [activeWorkspaceId, collapsedWorkspaceIds, draftWorkspaceId, workspaces],
  );
  const capabilities = useMemo<WorkspaceCapabilities>(
    () => ({
      activateWorkspace,
      deactivateWorkspace,
      revealWorkspace,
      toggleWorkspaceCollapsed,
      beginNewThread,
      beginNewThreadWithCreatedWorkspace: (workspace) =>
        acceptCreatedWorkspaceAndBeginThread(workspace, {
          acceptWorkspace: (createdWorkspace) => manager.acceptCreatedWorkspace(createdWorkspace),
          beginNewThread,
          refreshWorkspaces: () => manager.refreshWorkspaceMetadata(),
          onRefreshError: (error) =>
            console.error("[workbench-pi] workspace reconciliation failed", error),
        }),
      destroyNewThread,
      refreshWorkspaces: () => manager.refreshWorkspaceMetadata(),
      removeWorkspace: async (workspaceId) => {
        await manager.deleteWorkspace(workspaceId);
        discardWorkspace(workspaceId);
      },
      moveWorkspaceBefore: (workspaceId, beforeWorkspaceId) =>
        manager.moveWorkspaceBefore(workspaceId, beforeWorkspaceId),
      setWorkspacePinned: (workspaceId, pinned) => manager.setWorkspacePinned(workspaceId, pinned),
    }),
    [
      activateWorkspace,
      beginNewThread,
      deactivateWorkspace,
      destroyNewThread,
      discardWorkspace,
      manager,
      revealWorkspace,
      toggleWorkspaceCollapsed,
    ],
  );

  return (
    <WorkspaceSelectionProvider selection={selection} capabilities={capabilities}>
      {children}
    </WorkspaceSelectionProvider>
  );
}
