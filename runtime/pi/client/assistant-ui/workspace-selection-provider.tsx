"use client";

import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";

import {
  acceptCreatedWorkspaceAndBeginThread,
  addedWorkspaceIdsForReconciliation,
  resolveWorkspaceSelection,
  WorkspaceSelectionProvider,
  type WorkspaceCapabilities,
} from "@/services/workspace-selection-service";
import { useWorkspaceDirectoryStore } from "@/workbench/workspaces/workspace-directory-store";

import { openPiHostPath } from "../transport/api";
import { usePiSessionManager, usePiWorkspaces } from "../runtime/context";

/** Pi implementation of the Workbench workspace-selection capability. */
export function PiWorkspaceSelectionProvider({ children }: Readonly<{ children: ReactNode }>) {
  const manager = usePiSessionManager();
  const workspaces = usePiWorkspaces();
  const activeWorkspaceId = useWorkspaceDirectoryStore((state) => state.activeDirectoryId);
  const draftWorkspaceId = useWorkspaceDirectoryStore((state) => state.draftDirectoryId);
  const collapsedWorkspaceIds = useWorkspaceDirectoryStore((state) => state.collapsedDirectoryIds);
  const reconcileWorkspaceIds = useWorkspaceDirectoryStore((state) => state.reconcileDirectoryIds);
  const activateWorkspace = useWorkspaceDirectoryStore((state) => state.activateDirectory);
  const deactivateWorkspace = useWorkspaceDirectoryStore((state) => state.deactivateDirectory);
  const revealWorkspace = useWorkspaceDirectoryStore((state) => state.revealDirectory);
  const setWorkspaceCollapsed = useWorkspaceDirectoryStore((state) => state.setDirectoryCollapsed);
  const toggleWorkspaceCollapsed = useWorkspaceDirectoryStore((state) => state.toggleDirectory);
  const beginNewThread = useWorkspaceDirectoryStore((state) => state.beginNewThread);
  const destroyNewThread = useWorkspaceDirectoryStore((state) => state.destroyNewThread);
  const discardWorkspace = useWorkspaceDirectoryStore((state) => state.discardDirectory);
  const knownWorkspaceIds = useRef<readonly string[] | undefined>(undefined);

  useLayoutEffect(() => {
    const workspaceIds = workspaces.map((workspace) => workspace.id);
    const newlyAddedIds = addedWorkspaceIdsForReconciliation(
      knownWorkspaceIds.current,
      workspaceIds,
    );
    knownWorkspaceIds.current = workspaceIds;
    if (!newlyAddedIds) return;
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
      setWorkspaceCollapsed,
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
      openWorkspaceFolder: async (workspaceId) => {
        const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
        if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
        await openPiHostPath(workspace.cwd);
      },
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
      setWorkspaceCollapsed,
      toggleWorkspaceCollapsed,
      workspaces,
    ],
  );

  return (
    <WorkspaceSelectionProvider selection={selection} capabilities={capabilities}>
      {children}
    </WorkspaceSelectionProvider>
  );
}
