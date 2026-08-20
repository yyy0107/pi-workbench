import { homedir } from "node:os";
import path from "node:path";

import { WorkspaceStore } from "./workspace-store";

interface WorkspaceRegistryGlobal {
  __workbenchWorkspaceStore?: WorkspaceStore;
  __workbenchWorkspaceStateFile?: string;
}

const registryGlobal = globalThis as typeof globalThis & WorkspaceRegistryGlobal;

function configuredWorkspaceStateFile(): string {
  const explicitFile = process.env.PI_WORKBENCH_WORKSPACE_STATE_FILE?.trim();
  if (explicitFile) return path.resolve(explicitFile);

  const configuredDirectory = process.env.PI_WORKBENCH_STATE_DIR?.trim();
  const stateDirectory = configuredDirectory
    ? path.resolve(configuredDirectory)
    : path.join(homedir(), ".pi", "workbench");
  return path.join(stateDirectory, "workspaces.json");
}

export function getWorkspaceStore(): WorkspaceStore {
  const stateFile = configuredWorkspaceStateFile();
  if (
    !registryGlobal.__workbenchWorkspaceStore ||
    registryGlobal.__workbenchWorkspaceStateFile !== stateFile
  ) {
    registryGlobal.__workbenchWorkspaceStore = new WorkspaceStore({ stateFile });
    registryGlobal.__workbenchWorkspaceStateFile = stateFile;
  }
  return registryGlobal.__workbenchWorkspaceStore;
}
