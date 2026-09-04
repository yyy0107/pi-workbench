import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { configuredWorkbenchSettingsFile } from "@workbench/server-core/workbench-settings-file";
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

function hasLegacyStateOverride(): boolean {
  return Boolean(
    process.env.PI_WORKBENCH_IMAGE_UNDERSTANDING_STATE_FILE?.trim() ||
    process.env.PI_WORKBENCH_STATE_DIR?.trim(),
  );
}

export function getImageUnderstandingSettingsStore(): ImageUnderstandingSettingsStore {
  const legacyStateFile = configuredStateFile();
  const useLegacyStandaloneFile = hasLegacyStateOverride();
  const stateFile = useLegacyStandaloneFile
    ? legacyStateFile
    : configuredWorkbenchSettingsFile({
        defaultDirectory: getAgentDir(),
        configuredFile: process.env.PI_WORKBENCH_SETTINGS_FILE,
      });
  if (
    !registryGlobal.__workbenchImageUnderstandingSettings ||
    registryGlobal.__workbenchImageUnderstandingStateFile !== stateFile
  ) {
    registryGlobal.__workbenchImageUnderstandingSettings = new ImageUnderstandingSettingsStore({
      stateFile,
      ...(useLegacyStandaloneFile
        ? {}
        : { documentSection: "imageUnderstanding", legacyStateFile }),
    });
    registryGlobal.__workbenchImageUnderstandingStateFile = stateFile;
  }
  return registryGlobal.__workbenchImageUnderstandingSettings;
}
