import type { PiSessionSummary, PiWorkspaceSummary } from "@workbench/pi-rpc-contracts/messages";
import type { WorkspaceView } from "@workbench/pi-rpc-contracts/rpc";

export function workspaceViewsEqual(
  left: WorkspaceView | undefined,
  right: WorkspaceView,
): boolean {
  return (
    left !== undefined &&
    left.workspaceId === right.workspaceId &&
    left.path === right.path &&
    left.title === right.title &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.sessionIds.length === right.sessionIds.length &&
    left.sessionIds.every((sessionId, index) => sessionId === right.sessionIds[index])
  );
}

/** Authoritative client-side session/workspace directory projection for one manager installation. */
export class PiClientManagerCatalogState {
  readonly summaries = new Map<string, PiSessionSummary>();
  readonly workspaces = new Map<string, WorkspaceView>();
  readonly archived = new Set<string>();
  readonly pinned = new Set<string>();
  readonly pinnedWorkspaces = new Set<string>();
  readonly draftWorkspaces = new Map<string, PiWorkspaceSummary>();
  generation = 0;

  applyWorkspaceSnapshot(
    workspaces: readonly WorkspaceView[],
    pinnedWorkspaceIds: readonly string[],
    pinnedSessionIds: readonly string[],
    archivedSessionIds: readonly string[],
  ): void {
    this.workspaces.clear();
    for (const workspace of workspaces) this.workspaces.set(workspace.workspaceId, workspace);
    this.replaceSet(this.pinnedWorkspaces, pinnedWorkspaceIds);
    this.replaceSet(this.pinned, pinnedSessionIds);
    this.replaceSet(this.archived, archivedSessionIds);
  }

  setSessionArchived(sessionId: string, archived: boolean): boolean {
    const changed = this.archived.has(sessionId) !== archived;
    if (archived) this.archived.add(sessionId);
    else this.archived.delete(sessionId);
    return changed;
  }

  setSessionPinned(sessionId: string, pinned: boolean): boolean {
    const changed = this.pinned.has(sessionId) !== pinned;
    if (pinned) this.pinned.add(sessionId);
    else this.pinned.delete(sessionId);
    return changed;
  }

  setWorkspacePinned(workspaceId: string, pinned: boolean): boolean {
    const changed = this.pinnedWorkspaces.has(workspaceId) !== pinned;
    if (pinned) this.pinnedWorkspaces.add(workspaceId);
    else this.pinnedWorkspaces.delete(workspaceId);
    return changed;
  }

  setWorkspace(workspace: WorkspaceView): void {
    this.workspaces.set(workspace.workspaceId, workspace);
  }

  acceptCreatedWorkspace(workspace: PiWorkspaceSummary, now: string): boolean {
    this.generation += 1;
    const existing = this.workspaces.get(workspace.id);
    const accepted: WorkspaceView = existing
      ? { ...existing, path: workspace.cwd, title: workspace.name }
      : {
          workspaceId: workspace.id,
          path: workspace.cwd,
          title: workspace.name,
          sessionIds: [],
          createdAt: now,
          updatedAt: now,
        };
    const workspaceChanged = !workspaceViewsEqual(existing, accepted);
    this.setWorkspace(accepted);
    const pinnedChanged =
      workspace.pinned === undefined
        ? false
        : this.setWorkspacePinned(workspace.id, workspace.pinned);
    return workspaceChanged || pinnedChanged;
  }

  removeWorkspace(workspaceId: string): boolean {
    const changed = this.workspaces.delete(workspaceId);
    return this.pinnedWorkspaces.delete(workspaceId) || changed;
  }

  reorderWorkspaces(workspaceIds: readonly string[]): boolean {
    const reordered = new Map<string, WorkspaceView>();
    for (const id of workspaceIds) {
      const workspace = this.workspaces.get(id);
      if (workspace) reordered.set(id, workspace);
    }
    for (const [id, workspace] of this.workspaces)
      if (!reordered.has(id)) reordered.set(id, workspace);
    const reorderedIds = [...reordered.keys()];
    const changed = [...this.workspaces.keys()].some((id, index) => id !== reorderedIds[index]);
    if (!changed) return false;
    this.workspaces.clear();
    for (const [id, workspace] of reordered) this.workspaces.set(id, workspace);
    return true;
  }

  private replaceSet(target: Set<string>, values: readonly string[]): void {
    target.clear();
    for (const value of values) target.add(value);
  }

  dispose(): void {
    this.summaries.clear();
    this.workspaces.clear();
    this.archived.clear();
    this.pinned.clear();
    this.pinnedWorkspaces.clear();
    this.draftWorkspaces.clear();
    this.generation += 1;
  }
}
