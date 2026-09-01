import path from "node:path";

import { WorkbenchSettingsService } from "@workbench/settings-server/service";

export interface ExplicitWebWorkbenchSettingsOptions {
  /** An outer launcher-selected settings file. The Web app never guesses a Pi installation. */
  readonly configuredFile?: string;
  readonly workingDirectory?: string;
}

/**
 * Resolve the optional, explicitly configured settings file used by Web SSR.
 *
 * The installed Runtime owns the Pi default-directory policy. Keeping the no-configuration case
 * as `undefined` prevents the Web process from importing Pi or duplicating its agent-directory
 * resolution policy.
 */
export function explicitWebWorkbenchSettingsFile({
  configuredFile = process.env.PI_WORKBENCH_SETTINGS_FILE,
  workingDirectory = process.cwd(),
}: ExplicitWebWorkbenchSettingsOptions = {}): string | undefined {
  const value = configuredFile?.trim();
  return value ? path.resolve(workingDirectory, value) : undefined;
}

export function createExplicitWebWorkbenchSettingsService(
  options: ExplicitWebWorkbenchSettingsOptions = {},
): WorkbenchSettingsService | undefined {
  const stateFile = explicitWebWorkbenchSettingsFile(options);
  return stateFile ? new WorkbenchSettingsService({ stateFile }) : undefined;
}
