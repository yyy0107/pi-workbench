import type { WorkbenchToolDependencies } from "@workbench/pi-tools/dependencies";
import {
  createWorkbenchInternalPiExtensions as createExtensions,
  prepareWorkbenchPiExtensions as prepareExtensions,
} from "@workbench/pi-tools";
import { createContextTraceExtension } from "@workbench/pi-tools/context-trace";
import {
  createWorkbenchSettingsExtension as createSettingsExtension,
  workbenchSettingsExtension as registerSettings,
} from "@workbench/pi-tools/workbench-settings";
import { instrumentSystemPromptHookTracing as instrumentTracing } from "@workbench/pi-tools/system-prompt-hook-trace";
import {
  getPiAgentHostBindings,
  isBuiltinResourceEnabled,
} from "./agent-runtime/pi-agent-host-bindings";
import { getSessionContextTrace } from "@workbench/pi-session-server/session-context-trace";
import { AgentSettingsService } from "./resource-composition/settings";
import { getWorkspaceStore } from "./workspaces/workspace-registry";
import { scopedUpdatePayload } from "./transport/agent-settings-rpc-validators";
import type { ExtensionFactory, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import type {
  AskUserCapabilitySettings,
  BuiltinToolSettings,
  ToolCapabilitySettings,
} from "@workbench/pi-server-ports/tools";
const dependencies: WorkbenchToolDependencies = {
  getHostBindings: getPiAgentHostBindings,
  getSessionContextTrace,
  isBuiltinResourceEnabled,
  createAgentSettingsService: () => new AgentSettingsService(),
  listWorkspaces: async () => (await getWorkspaceStore().list()).items,
  validateSettingsUpdate: scopedUpdatePayload,
};
export function createWorkbenchInternalPiExtensions(
  askUser?: AskUserCapabilitySettings,
  todo?: ToolCapabilitySettings,
  builtin?: BuiltinToolSettings,
  settings?: ToolCapabilitySettings,
) {
  return createExtensions(dependencies, askUser, todo, builtin, settings);
}
export const workbenchInternalPiExtensions = createWorkbenchInternalPiExtensions();
export const contextTraceExtension = createContextTraceExtension(
  dependencies.getSessionContextTrace,
);
export function prepareWorkbenchPiExtensions(result: LoadExtensionsResult) {
  return prepareExtensions(result, dependencies);
}
export function instrumentSystemPromptHookTracing(result: LoadExtensionsResult) {
  return instrumentTracing(result, dependencies);
}
export function createWorkbenchSettingsExtension(settings?: ToolCapabilitySettings) {
  return createSettingsExtension(dependencies, settings);
}
export function workbenchSettingsExtension(
  pi: Parameters<ExtensionFactory>[0],
  settings?: ToolCapabilitySettings,
) {
  return registerSettings(pi, dependencies, settings);
}
