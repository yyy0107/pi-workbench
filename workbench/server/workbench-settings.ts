import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { configuredWorkbenchSettingsFile } from "@/runtime/server/settings/workbench-settings-file";
import { WorkbenchSettingsService } from "@/runtime/server/settings/workbench-settings-service";

/** The single application boundary that binds the installed Pi runtime's directory to Host settings. */
export function configuredInstalledWorkbenchSettingsFile(): string {
  return configuredWorkbenchSettingsFile({
    defaultDirectory: getAgentDir(),
    configuredFile: process.env.PI_WORKBENCH_SETTINGS_FILE,
  });
}

export function createInstalledWorkbenchSettingsService(): WorkbenchSettingsService {
  return new WorkbenchSettingsService({ stateFile: configuredInstalledWorkbenchSettingsFile() });
}
