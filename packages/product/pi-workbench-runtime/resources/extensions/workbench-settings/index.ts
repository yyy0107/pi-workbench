import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { ToolCapabilitySettings } from "@workbench/pi-sdk-ports/tools";
import type { WorkbenchToolDependencies } from "../../../src/tool-runtime/dependencies";
import { bindToolAvailability } from "../../../src/tool-runtime/tool-availability";
import { createWorkbenchSettingsTool } from "../../../src/workbench-settings/index";
export * from "../../../src/workbench-settings/index";
export function workbenchSettingsExtension(
  pi: Parameters<ExtensionFactory>[0],
  dependencies: WorkbenchToolDependencies,
  toolSettings?: ToolCapabilitySettings,
): void {
  if (!dependencies.getHostBindings().workbenchSettings) return;
  const readEnabled = bindToolAvailability(pi, "workbench_settings", toolSettings, false);
  pi.registerTool(createWorkbenchSettingsTool(dependencies, readEnabled));
}
export function createWorkbenchSettingsExtension(
  dependencies: WorkbenchToolDependencies,
  toolSettings?: ToolCapabilitySettings,
): ExtensionFactory {
  return (pi) => workbenchSettingsExtension(pi, dependencies, toolSettings);
}
