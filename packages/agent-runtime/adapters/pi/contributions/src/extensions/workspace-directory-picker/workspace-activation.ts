import type { WorkbenchWorkspaceSummary } from "@workbench/agent-runtime-client/workspaces";

interface CreatedWorkspaceActivationActions {
  beginNewThreadWithCreatedWorkspace(workspace: WorkbenchWorkspaceSummary): void;
  createDraft(workspaceId: string): void | Promise<void>;
  navigateHome(): void;
}

export async function activateCreatedWorkspace(
  workspace: WorkbenchWorkspaceSummary,
  actions: CreatedWorkspaceActivationActions,
): Promise<void> {
  actions.beginNewThreadWithCreatedWorkspace(workspace);
  await actions.createDraft(workspace.id);
  actions.navigateHome();
}
