import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { configuredWorkbenchSettingsFile } from "@workbench/settings-server/file";
import { WorkbenchSettingsService } from "@workbench/settings-server/service";
import { workbenchSettingsUpdatePayload } from "@workbench/settings-server/rpc";
import type { WorkbenchSettingsProtocol } from "@workbench/agent-runtime-contracts/settings";

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

/** Agent access uses the same validation and persistence as the settings UI. */
export function createInstalledWorkbenchSettingsAgentAccess(): Pick<
  WorkbenchSettingsProtocol,
  "describe" | "update"
> {
  const service = createInstalledWorkbenchSettingsService();
  return {
    describe: () => service.describe(),
    async update(payload) {
      const parsed = workbenchSettingsUpdatePayload(payload);
      if (!parsed.ok) {
        throw new TypeError(
          `Invalid Workbench settings: ${parsed.issues.map((issue) => issue.path.join(".")).join(", ")}`,
        );
      }
      // RPC strips unknown fields for compatibility; agent typos must not report success.
      const unknown = Object.keys(payload.patch).filter(
        (key) => !Object.hasOwn(parsed.value.patch, key),
      );
      if (unknown.length)
        throw new TypeError(`Unknown Workbench preferences: ${unknown.join(", ")}`);
      return service.update(parsed.value);
    },
  };
}
