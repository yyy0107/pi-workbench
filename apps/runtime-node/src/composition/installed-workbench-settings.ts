import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { configuredWorkbenchSettingsFile } from "@workbench/settings-server/file";
import { WorkbenchSettingsService } from "@workbench/settings-server/service";

/** Binds the Runtime app's installed Pi directory to the shared Workbench settings service. */
export function configuredInstalledWorkbenchSettingsFile(): string {
  return configuredWorkbenchSettingsFile({
    defaultDirectory: getAgentDir(),
    configuredFile: process.env.PI_WORKBENCH_SETTINGS_FILE,
  });
}

export function createInstalledWorkbenchSettingsService(): WorkbenchSettingsService {
  return new WorkbenchSettingsService({ stateFile: configuredInstalledWorkbenchSettingsFile() });
}
