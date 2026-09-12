"use client";

import { createContext, useContext, type ReactNode } from "react";

/** Workbench-owned workspace projection. Native runtimes map their own path fields at the edge. */
export interface WorkbenchWorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly pinned?: boolean;
}

export interface WorkbenchWorkspaceSelection {
  readonly workspaces: readonly WorkbenchWorkspaceSummary[];
  readonly activeWorkspaceId?: string;
  readonly activeWorkspace?: WorkbenchWorkspaceSummary;
  readonly draftWorkspaceId?: string;
  readonly draftWorkspace?: WorkbenchWorkspaceSummary;
  readonly collapsedWorkspaceIds: readonly string[];
}

export interface WorkbenchWorkspaceCapabilities {
  activateWorkspace(workspaceId: string): void;
  deactivateWorkspace(): void;
  revealWorkspace(workspaceId: string): void;
  setWorkspaceCollapsed(workspaceId: string, collapsed: boolean): void;
  toggleWorkspaceCollapsed(workspaceId: string): void;
  beginNewThread(workspaceId: string): void;
  beginNewThreadWithCreatedWorkspace(workspace: WorkbenchWorkspaceSummary): void;
  destroyNewThread(): void;
  refreshWorkspaces(): Promise<void>;
  openWorkspaceFolder(workspaceId: string): Promise<void>;
  removeWorkspace(workspaceId: string): Promise<void>;
  moveWorkspaceBefore(workspaceId: string, beforeWorkspaceId?: string): Promise<void>;
  setWorkspacePinned(workspaceId: string, pinned: boolean): Promise<void>;
}

/** Stable state exposed by the application-owned workspace directory UI store. */
export interface WorkbenchWorkspaceDirectorySnapshot {
  readonly activeDirectoryId?: string;
  readonly draftDirectoryId?: string;
  readonly collapsedDirectoryIds: readonly string[];
}

export interface WorkbenchWorkspaceDirectoryActions {
  reconcileDirectoryIds(ids: readonly string[], newlyAddedIds: readonly string[]): void;
  discardDirectory(id: string): void;
  activateDirectory(id: string): void;
  deactivateDirectory(): void;
  revealDirectory(id: string): void;
  setDirectoryCollapsed(id: string, collapsed: boolean): void;
  toggleDirectory(id: string): void;
  beginNewThread(id: string): void;
  destroyNewThread(): void;
}

/** Narrow host bridge; concrete Zustand or Redux state never crosses into a runtime package. */
export interface WorkbenchWorkspaceDirectoryStorePort {
  getSnapshot(): WorkbenchWorkspaceDirectorySnapshot;
  subscribe(listener: () => void): () => void;
  readonly actions: WorkbenchWorkspaceDirectoryActions;
}

interface CreatedWorkspaceAdmissionOperations {
  acceptWorkspace(workspace: WorkbenchWorkspaceSummary): void;
  beginNewThread(workspaceId: string): void;
  refreshWorkspaces(): Promise<void>;
  onRefreshError(error: unknown): void;
}

export function acceptCreatedWorkspaceAndBeginThread(
  workspace: WorkbenchWorkspaceSummary,
  operations: CreatedWorkspaceAdmissionOperations,
): void {
  operations.acceptWorkspace(workspace);
  operations.beginNewThread(workspace.id);
  void operations.refreshWorkspaces().catch(operations.onRefreshError);
}

export function addedWorkspaceIdsForReconciliation(
  previousIds: readonly string[] | undefined,
  currentIds: readonly string[],
): readonly string[] | undefined {
  if (!previousIds) return currentIds.slice(1);

  const previousIdSet = new Set(previousIds);
  const membershipUnchanged =
    previousIds.length === currentIds.length && currentIds.every((id) => previousIdSet.has(id));
  if (membershipUnchanged) return undefined;

  return currentIds.filter((id) => !previousIdSet.has(id));
}

interface WorkspaceSelectionIds {
  readonly activeWorkspaceId?: string;
  readonly draftWorkspaceId?: string;
  readonly collapsedWorkspaceIds: readonly string[];
}

export function resolveWorkspaceSelection(
  workspaces: readonly WorkbenchWorkspaceSummary[],
  ids: WorkspaceSelectionIds,
): WorkbenchWorkspaceSelection {
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));
  const activeWorkspace = workspaces.find((workspace) => workspace.id === ids.activeWorkspaceId);
  const draftWorkspace = workspaces.find((workspace) => workspace.id === ids.draftWorkspaceId);

  return {
    workspaces,
    ...(activeWorkspace ? { activeWorkspaceId: activeWorkspace.id, activeWorkspace } : {}),
    ...(draftWorkspace ? { draftWorkspaceId: draftWorkspace.id, draftWorkspace } : {}),
    collapsedWorkspaceIds: ids.collapsedWorkspaceIds.filter((id) => workspaceIds.has(id)),
  };
}

const WorkspaceSelectionContext = createContext<WorkbenchWorkspaceSelection | null>(null);
const WorkspaceCapabilitiesContext = createContext<WorkbenchWorkspaceCapabilities | null>(null);

export function WorkbenchWorkspaceSelectionProvider({
  capabilities,
  children,
  selection,
}: Readonly<{
  capabilities: WorkbenchWorkspaceCapabilities;
  children: ReactNode;
  selection: WorkbenchWorkspaceSelection;
}>) {
  return (
    <WorkspaceCapabilitiesContext.Provider value={capabilities}>
      <WorkspaceSelectionContext.Provider value={selection}>
        {children}
      </WorkspaceSelectionContext.Provider>
    </WorkspaceCapabilitiesContext.Provider>
  );
}

export function useWorkbenchWorkspaceSelection(): WorkbenchWorkspaceSelection {
  const selection = useContext(WorkspaceSelectionContext);
  if (!selection) throw new Error("WorkbenchWorkspaceSelectionProvider is missing");
  return selection;
}

export function useWorkbenchWorkspaceCapabilities(): WorkbenchWorkspaceCapabilities {
  const capabilities = useContext(WorkspaceCapabilitiesContext);
  if (!capabilities) throw new Error("WorkbenchWorkspaceSelectionProvider is missing");
  return capabilities;
}

// Compatibility names for root consumers while imports move to the package boundary.
export type WorkspaceSummary = WorkbenchWorkspaceSummary;
export type WorkspaceSelection = WorkbenchWorkspaceSelection;
export type WorkspaceCapabilities = WorkbenchWorkspaceCapabilities;
export const WorkspaceSelectionProvider = WorkbenchWorkspaceSelectionProvider;
export const useWorkspaceSelection = useWorkbenchWorkspaceSelection;
export const useWorkspaceCapabilities = useWorkbenchWorkspaceCapabilities;
