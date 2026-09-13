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
export { CommandService } from "../resource-composition";
export type { CommandCatalogProtocol } from "@workbench/pi-sdk-resources/commands";
export { shutdownPiPackageCatalogService } from "@workbench/pi-sdk-resources/catalog";
// Use the package service's SDK instance; pnpm can install distinct peer-context instances.
export { isStdoutTakenOver, restoreStdout, takeOverStdout } from "@earendil-works/pi-coding-agent";
export {
  type PiAutomationRuntimeBindingOptions,
  type PiAutomationRuntimeBindings,
  type PiAutomationWorkspace,
} from "@workbench/pi-sdk-sessions/automation";
export { createPiAutomationRuntimeBindings } from "../session-composition";

export {
  resolvePiWorkspaceRoot,
  resolvePiWorkspaceId,
  mutatePiWorkspace,
} from "../workspaces/workspace-service-bindings";

export { resolvePiReviewSnapshots } from "../session-composition/registry";
