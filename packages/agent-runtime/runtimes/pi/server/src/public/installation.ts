export {
  bindPiAgentHostBindings,
  getPiAgentHostBindings,
  type PiAgentHostBindings,
  type PiBashToolFactoryInput,
} from "../agent-runtime/pi-agent-host-bindings";
export {
  createPiAgentServerImplementation,
  type PiAgentServerImplementationDependencies,
} from "../agent-runtime/pi-agent-server-implementation";
export { CommandService, type CommandCatalogProtocol } from "../commands/command-service";
export { shutdownPiPackageCatalogService } from "../packages/package-catalog-service";
// Use the package service's SDK instance; pnpm can install distinct peer-context instances.
export { isStdoutTakenOver, restoreStdout, takeOverStdout } from "@earendil-works/pi-coding-agent";
export {
  createPiAutomationRuntimeBindings,
  type PiAutomationRuntimeBindingOptions,
  type PiAutomationRuntimeBindings,
  type PiAutomationWorkspace,
} from "../automations/pi-automation-service";

export {
  resolvePiWorkspaceRoot,
  resolvePiWorkspaceId,
  mutatePiWorkspace,
} from "../workspaces/workspace-service-bindings";
