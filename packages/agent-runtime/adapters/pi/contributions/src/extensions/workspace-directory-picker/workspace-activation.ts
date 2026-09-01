import type { WorkbenchWorkspaceSummary } from "@workbench/agent-runtime-client/workspaces";

interface CreatedWorkspaceActivationActions {
  beginNewThreadWithCreatedWorkspace(workspace: WorkbenchWorkspaceSummary): void;
  switchToNewThread(): void | Promise<void>;
  navigateHome(): void;
}

export async function activateCreatedWorkspace(
  workspace: WorkbenchWorkspaceSummary,
  actions: CreatedWorkspaceActivationActions,
): Promise<void> {
  actions.beginNewThreadWithCreatedWorkspace(workspace);
  await actions.switchToNewThread();
  actions.navigateHome();
}
