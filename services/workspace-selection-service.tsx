"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { PiWorkspaceSummary } from "@/runtime/pi/contracts";

export type WorkspaceSummary = PiWorkspaceSummary;

export interface WorkspaceSelection {
  readonly workspaces: readonly WorkspaceSummary[];
  readonly activeWorkspaceId?: string;
  readonly activeWorkspace?: WorkspaceSummary;
  readonly draftWorkspaceId?: string;
  readonly draftWorkspace?: WorkspaceSummary;
  readonly collapsedWorkspaceIds: readonly string[];
}

export interface WorkspaceCapabilities {
  activateWorkspace(workspaceId: string): void;
  deactivateWorkspace(): void;
  revealWorkspace(workspaceId: string): void;
  setWorkspaceCollapsed(workspaceId: string, collapsed: boolean): void;
  toggleWorkspaceCollapsed(workspaceId: string): void;
  beginNewThread(workspaceId: string): void;
  beginNewThreadWithCreatedWorkspace(workspace: WorkspaceSummary): void;
  destroyNewThread(): void;
  refreshWorkspaces(): Promise<void>;
  removeWorkspace(workspaceId: string): Promise<void>;
  moveWorkspaceBefore(workspaceId: string, beforeWorkspaceId?: string): Promise<void>;
  setWorkspacePinned(workspaceId: string, pinned: boolean): Promise<void>;
}

interface CreatedWorkspaceAdmissionOperations {
  acceptWorkspace(workspace: WorkspaceSummary): void;
  beginNewThread(workspaceId: string): void;
  refreshWorkspaces(): Promise<void>;
  onRefreshError(error: unknown): void;
}

export function acceptCreatedWorkspaceAndBeginThread(
  workspace: WorkspaceSummary,
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
  workspaces: readonly WorkspaceSummary[],
  ids: WorkspaceSelectionIds,
): WorkspaceSelection {
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

const WorkspaceSelectionContext = createContext<WorkspaceSelection | null>(null);
const WorkspaceCapabilitiesContext = createContext<WorkspaceCapabilities | null>(null);

export function WorkspaceSelectionProvider({
  capabilities,
  children,
  selection,
}: Readonly<{
  capabilities: WorkspaceCapabilities;
  children: ReactNode;
  selection: WorkspaceSelection;
}>) {
  return (
    <WorkspaceCapabilitiesContext.Provider value={capabilities}>
      <WorkspaceSelectionContext.Provider value={selection}>
        {children}
      </WorkspaceSelectionContext.Provider>
    </WorkspaceCapabilitiesContext.Provider>
  );
}

export function useWorkspaceSelection(): WorkspaceSelection {
  const selection = useContext(WorkspaceSelectionContext);
  if (!selection) throw new Error("WorkspaceSelectionProvider is missing");
  return selection;
}

export function useWorkspaceCapabilities(): WorkspaceCapabilities {
  const capabilities = useContext(WorkspaceCapabilitiesContext);
  if (!capabilities) throw new Error("WorkspaceSelectionProvider is missing");
  return capabilities;
}
