import type {
  WorkbenchSettingsPort,
  WorkbenchSettingsPreferences,
  WorkbenchSettingsPreferencesPatch,
} from "@workbench/agent-runtime-contracts/settings";
import {
  loadWorkbenchSettingsPreferences as loadPiWorkbenchSettingsPreferences,
  updateWorkbenchSettingsPreferences as updatePiWorkbenchSettingsPreferences,
} from "@/workbench/runtime-contributions/pi/client/configuration";

export {
  toWorkbenchSettingsJsonObject,
  type WorkbenchBackgroundImagePreference,
  type WorkbenchModelSelectorPreference,
  type WorkbenchSettingsJsonValue,
  type WorkbenchSettingsPreferences,
  type WorkbenchSettingsPreferencesPatch,
  type WorkbenchSidebarThreadSortMode,
  type WorkbenchToolboxScopePreference,
} from "@workbench/agent-runtime-contracts/settings";

/** Application composition boundary for the Workbench-owned settings schema. */
export const workbenchSettingsService: WorkbenchSettingsPort = Object.freeze({
  load: loadPiWorkbenchSettingsPreferences,
  update: updatePiWorkbenchSettingsPreferences,
});

export function loadWorkbenchSettingsPreferences(): Promise<WorkbenchSettingsPreferences> {
  return workbenchSettingsService.load();
}

export function updateWorkbenchSettingsPreferences(
  patch: WorkbenchSettingsPreferencesPatch,
): Promise<void> {
  return workbenchSettingsService.update(patch);
}
