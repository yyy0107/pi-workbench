import type { PiWorkspaceSummary } from "@/runtime/pi/contracts";

interface CreatedWorkspaceActivationActions {
  beginNewThreadWithCreatedWorkspace(workspace: PiWorkspaceSummary): void;
  switchToNewThread(): void | Promise<void>;
  navigateHome(): void;
}

export async function activateCreatedWorkspace(
  workspace: PiWorkspaceSummary,
  actions: CreatedWorkspaceActivationActions,
): Promise<void> {
  actions.beginNewThreadWithCreatedWorkspace(workspace);
  await actions.switchToNewThread();
  actions.navigateHome();
}
