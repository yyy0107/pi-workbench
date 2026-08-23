import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { ImageUnderstandingSettingsStore } from "./settings-store";

interface ImageUnderstandingRegistryGlobal {
  __workbenchImageUnderstandingSettings?: ImageUnderstandingSettingsStore;
  __workbenchImageUnderstandingStateFile?: string;
}

const registryGlobal = globalThis as typeof globalThis & ImageUnderstandingRegistryGlobal;

function configuredStateFile(): string {
  const explicit = process.env.PI_WORKBENCH_IMAGE_UNDERSTANDING_STATE_FILE?.trim();
  if (explicit) return path.resolve(explicit);
  const stateDirectory = process.env.PI_WORKBENCH_STATE_DIR?.trim();
  return stateDirectory
    ? path.join(path.resolve(stateDirectory), "image-understanding.json")
    : path.join(getAgentDir(), "workbench", "image-understanding.json");
}

export function getImageUnderstandingSettingsStore(): ImageUnderstandingSettingsStore {
  const stateFile = configuredStateFile();
  if (
    !registryGlobal.__workbenchImageUnderstandingSettings ||
    registryGlobal.__workbenchImageUnderstandingStateFile !== stateFile
  ) {
    registryGlobal.__workbenchImageUnderstandingSettings = new ImageUnderstandingSettingsStore({
      stateFile,
    });
    registryGlobal.__workbenchImageUnderstandingStateFile = stateFile;
  }
  return registryGlobal.__workbenchImageUnderstandingSettings;
}
