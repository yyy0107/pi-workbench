import {
  WorkspaceGitServiceError,
  type WorkspaceMutationResult,
} from "@workbench/workspace-server/git";
import {
  getPiResourceMutationCoordinator,
  PiResourceMutationBusyError,
} from "../resources/pi-resource-mutation-coordinator";

export { resolvePiWorkspaceRoot, resolvePiWorkspaceId } from "./workspace-registry";

export async function mutatePiWorkspace<Value>(
  rootPath: string,
  operation: () => Promise<WorkspaceMutationResult<Value>>,
): Promise<Value> {
  try {
    return await getPiResourceMutationCoordinator().mutate(
      { scope: "project", cwd: rootPath },
      async () => {
        const result = await operation();
        return { value: result.value, reload: result.changed };
      },
    );
  } catch (error) {
    if (error instanceof PiResourceMutationBusyError) {
      throw new WorkspaceGitServiceError(
        "session-busy",
        "A related session is currently running.",
        { sessionId: error.sessionId },
        { cause: error },
      );
    }
    throw error;
  }
}
