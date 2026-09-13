"use client";

import { useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";

import {
  acceptCreatedWorkspaceAndBeginThread,
  addedWorkspaceIdsForReconciliation,
  resolveWorkspaceSelection,
  WorkspaceSelectionProvider,
  type WorkspaceCapabilities,
  type WorkbenchWorkspaceDirectoryStorePort,
  type WorkbenchWorkspaceSummary,
} from "@workbench/agent-runtime-client/workspaces";

import type { WorkbenchServicesCapabilities } from "@workbench/agent-runtime-client/capabilities";
import { usePiSessionManager, usePiWorkspaces } from "../runtime/context";

/** Pi implementation of the Workbench workspace-selection capability. */
export function PiWorkspaceSelectionProvider({
  children,
  directoryStore,
  host,
}: Readonly<{
  children: ReactNode;
  directoryStore: WorkbenchWorkspaceDirectoryStorePort;
  host: WorkbenchServicesCapabilities["host"];
}>) {
  const manager = usePiSessionManager();
  const piWorkspaces = usePiWorkspaces();
  const workspaces = useMemo<readonly WorkbenchWorkspaceSummary[]>(
    () =>
      piWorkspaces.map(({ cwd, ...workspace }) => ({
        ...workspace,
        rootPath: cwd,
      })),
    [piWorkspaces],
  );
  const directory = useSyncExternalStore(
    directoryStore.subscribe,
    directoryStore.getSnapshot,
    directoryStore.getSnapshot,
  );
  const { activeDirectoryId: activeWorkspaceId, draftDirectoryId: draftWorkspaceId } = directory;
  const collapsedWorkspaceIds = directory.collapsedDirectoryIds;
  const {
    reconcileDirectoryIds: reconcileWorkspaceIds,
    activateDirectory: activateWorkspace,
    deactivateDirectory: deactivateWorkspace,
    revealDirectory: revealWorkspace,
    setDirectoryCollapsed: setWorkspaceCollapsed,
    toggleDirectory: toggleWorkspaceCollapsed,
    beginNewThread,
    destroyNewThread,
    discardDirectory: discardWorkspace,
  } = directoryStore.actions;
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
          acceptWorkspace: (createdWorkspace) =>
            manager.acceptCreatedWorkspace({
              id: createdWorkspace.id,
              name: createdWorkspace.name,
              cwd: createdWorkspace.rootPath,
              ...(createdWorkspace.pinned === undefined ? {} : { pinned: createdWorkspace.pinned }),
            }),
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
        await host.openPath(workspace.rootPath);
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
      host,
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
