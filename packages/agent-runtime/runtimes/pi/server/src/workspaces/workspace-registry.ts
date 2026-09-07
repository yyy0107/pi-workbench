import { homedir } from "node:os";
import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { configuredWorkbenchSettingsFile } from "@workbench/server-core/workbench-settings-file";
import { WorkspaceStore } from "./workspace-store";

interface WorkspaceRegistryGlobal {
  __workbenchWorkspaceStore?: WorkspaceStore;
  __workbenchWorkspaceStateFile?: string;
  __workbenchWorkspaceStoreImplementationVersion?: number;
}

const registryGlobal = globalThis as typeof globalThis & WorkspaceRegistryGlobal;
const WORKSPACE_STORE_IMPLEMENTATION_VERSION = 4;

export async function resolvePiWorkspaceRoot(workspaceId: string): Promise<string | undefined> {
  return (await getWorkspaceStore().list()).items.find((item) => item.workspaceId === workspaceId)
    ?.path;
}

function hasLegacyStateOverride(): boolean {
  return Boolean(
    process.env.PI_WORKBENCH_WORKSPACE_STATE_FILE?.trim() ||
    process.env.PI_WORKBENCH_STATE_DIR?.trim(),
  );
}

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
  const legacyStateFile = configuredWorkspaceStateFile();
  const useLegacyStandaloneFile = hasLegacyStateOverride();
  const stateFile = useLegacyStandaloneFile
    ? legacyStateFile
    : configuredWorkbenchSettingsFile({
        defaultDirectory: getAgentDir(),
        configuredFile: process.env.PI_WORKBENCH_SETTINGS_FILE,
      });
  if (
    !registryGlobal.__workbenchWorkspaceStore ||
    registryGlobal.__workbenchWorkspaceStateFile !== stateFile ||
    registryGlobal.__workbenchWorkspaceStoreImplementationVersion !==
      WORKSPACE_STORE_IMPLEMENTATION_VERSION
  ) {
    registryGlobal.__workbenchWorkspaceStore = new WorkspaceStore({
      stateFile,
      ...(useLegacyStandaloneFile ? {} : { documentSection: "workspaces", legacyStateFile }),
    });
    registryGlobal.__workbenchWorkspaceStateFile = stateFile;
    registryGlobal.__workbenchWorkspaceStoreImplementationVersion =
      WORKSPACE_STORE_IMPLEMENTATION_VERSION;
  }
  return registryGlobal.__workbenchWorkspaceStore;
}
