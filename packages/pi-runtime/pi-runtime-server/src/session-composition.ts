import * as registry from "./session-composition/registry";
import { getWorkspaceStore } from "./workspaces/workspace-registry";
import { getStreamHub } from "./streams/stream-hub";
import { ModelService } from "@workbench/pi-sdk-models";
import { getProjectTrustService } from "@workbench/pi-sdk-resources/trust";
import {
  getSessionContextTrace,
  readSessionContextTracePromptParts,
} from "@workbench/pi-sdk-sessions/session-context-trace";
import * as Interactive from "@workbench/pi-sdk-sessions/interactive";
import * as Scratch from "@workbench/pi-sdk-sessions/scratch";
import * as Protocol from "@workbench/pi-sdk-sessions/protocol";
import * as Imports from "@workbench/pi-sdk-sessions/imports";
import * as Automation from "@workbench/pi-sdk-sessions/automation";
import * as Export from "@workbench/pi-sdk-sessions/export";
import { createUsageStatisticsReader } from "@workbench/pi-sdk-sessions/usage";
const {
  getOrStartSession,
  createSession,
  forkSession,
  listSessions,
  listSessionSearchText,
  listModels,
  getSessionHistory,
  getSessionEvents,
  getSessionEventBranches,
  getSessionResumeState,
  regenerateSession,
  resumeSession,
  selectSessionBranch,
  renameSession,
  deleteSession,
  cancelSession,
  selectSessionModel,
  getSessionContextPolicy,
  updateSessionContextPolicy,
  compactSessionContext,
  submitPrompt,
  updatePromptQueueItem,
} = registry;
import * as PiSessionHistoryServiceModule from "@workbench/pi-sdk-sessions/history";
type PiSessionHistoryServiceDependencies =
  PiSessionHistoryServiceModule.PiSessionHistoryServiceDependencies;
function defaultPiSessionHistoryService(): PiSessionHistoryServiceDependencies {
  return {
    getSessionEventBranches,
    getSessionEvents,
    getSessionHistory,
    getSessionResumeState,
  };
}
export function createPiSessionHistoryService(
  overrides: Partial<PiSessionHistoryServiceDependencies> = {},
) {
  return PiSessionHistoryServiceModule.createPiSessionHistoryService(
    defaultPiSessionHistoryService(),
    overrides,
  );
}
import * as PiSessionModelContextServiceModule from "@workbench/pi-sdk-sessions/model-context";
type PiSessionModelContextServiceDependencies =
  PiSessionModelContextServiceModule.PiSessionModelContextServiceDependencies;
function defaultPiSessionModelContextService(): PiSessionModelContextServiceDependencies {
  return {
    getSessionHistory,
    getModelCatalog: (cwd) =>
      new ModelService({
        cwd,
        resolveProjectTrust: async (path) => getProjectTrustService().isTrusted(path),
        getRequestObserver: getSessionContextTrace,
      }).models(),
    listModels,
    selectSessionModel,
    getSessionContextPolicy,
    updateSessionContextPolicy,
    compactSessionContext,
  };
}
export function createPiSessionModelContextService(
  overrides: Partial<PiSessionModelContextServiceDependencies> = {},
) {
  return PiSessionModelContextServiceModule.createPiSessionModelContextService(
    defaultPiSessionModelContextService(),
    overrides,
  );
}
import * as PiSessionContextTraceServiceModule from "@workbench/pi-sdk-sessions/context-trace";
type PiSessionContextTraceServiceDependencies =
  PiSessionContextTraceServiceModule.PiSessionContextTraceServiceDependencies;
function defaultPiSessionContextTraceService(): PiSessionContextTraceServiceDependencies {
  return {
    listSessions,
    startSession: getOrStartSession,
    getTrace: getSessionContextTrace,
    readPromptParts: readSessionContextTracePromptParts,
  };
}
export function createPiSessionContextTraceService(
  overrides: Partial<PiSessionContextTraceServiceDependencies> = {},
) {
  return PiSessionContextTraceServiceModule.createPiSessionContextTraceService(
    defaultPiSessionContextTraceService(),
    overrides,
  );
}
import * as PiAgentExecutionModule from "@workbench/pi-sdk-sessions/execution";
type PiAgentExecutionDependencies = PiAgentExecutionModule.PiAgentExecutionDependencies;
function defaultPiAgentExecution(): PiAgentExecutionDependencies {
  return {
    submitPrompt,
    regenerateSession,
    resumeSession,
    selectSessionBranch,
    updateQueueItem: updatePromptQueueItem,
    cancelSession,
  };
}
export function createPiAgentExecution(overrides: Partial<PiAgentExecutionDependencies> = {}) {
  return PiAgentExecutionModule.createPiAgentExecution(defaultPiAgentExecution(), overrides);
}
import * as PiAgentThreadStoreModule from "@workbench/pi-sdk-sessions/threads";
type PiAgentThreadStoreDependencies = PiAgentThreadStoreModule.PiAgentThreadStoreDependencies;
function defaultPiAgentThreadStore(): PiAgentThreadStoreDependencies {
  return {
    listSessions,
    listSessionSearchText,
    createSession,
    renameSession,
    forkSession,
    deleteSession,
  };
}
export function createPiAgentThreadStore(overrides: Partial<PiAgentThreadStoreDependencies> = {}) {
  return PiAgentThreadStoreModule.createPiAgentThreadStore(defaultPiAgentThreadStore(), overrides);
}
export class InteractiveResponseRegistry extends Interactive.InteractiveResponseRegistry {
  constructor(options: Partial<Interactive.InteractiveResponseRegistryOptions> = {}) {
    super({ hub: getStreamHub(), ...options });
  }
}
export function getInteractiveResponseRegistry() {
  return Interactive.getInteractiveResponseRegistry({ hub: getStreamHub() });
}
export function handleInteractiveResponsePost(
  request: Request,
  registry: Interactive.InteractiveResponseRegistry = getInteractiveResponseRegistry(),
) {
  return Interactive.handleInteractiveResponsePost(request, registry);
}
export function createPiScratchSessionStore() {
  return Scratch.createPiScratchSessionStore(registry);
}
type FacadeOptions = Omit<
  Protocol.PiSessionProtocolFacadeOptions,
  "resolveWorkspaceStore" | "history" | "modelContext" | "scratch"
> &
  Partial<
    Pick<
      Protocol.PiSessionProtocolFacadeOptions,
      "resolveWorkspaceStore" | "history" | "modelContext" | "scratch"
    >
  >;
export function createPiSessionProtocolFacade(options: FacadeOptions) {
  return Protocol.createPiSessionProtocolFacade({
    ...options,
    resolveWorkspaceStore: options.resolveWorkspaceStore ?? getWorkspaceStore,
    history: options.history ?? createPiSessionHistoryService(),
    modelContext: options.modelContext ?? createPiSessionModelContextService(),
    scratch: options.scratch ?? createPiScratchSessionStore(),
  });
}
const importDependencies: Imports.ExternalSessionImportDependencies = {
  registerImportedSessionManager: registry.registerImportedSessionManager,
  getWorkspaceStore,
};
export class ExternalSessionImportService extends Imports.ExternalSessionImportService {
  constructor(importers?: ConstructorParameters<typeof Imports.ExternalSessionImportService>[1]) {
    super(importDependencies, importers);
  }
}
export function getExternalSessionImportService() {
  return Imports.getExternalSessionImportService(importDependencies);
}
export function createPiAutomationRuntimeBindings(
  options: Automation.PiAutomationRuntimeBindingOptions,
) {
  return Automation.createPiAutomationRuntimeBindings({
    ...options,
    workspaceStore: getWorkspaceStore(),
    createSession: registry.createSession,
    getRunningSessionIds: registry.getRunningSessionIds,
  });
}
const exportDependencies = Export.createSessionExportDependencies(registry.listSessions);
export function handleSessionExportRequest(
  request: Request,
  dependencies: Export.SessionExportDependencies = exportDependencies,
) {
  return Export.handleSessionExportRequest(request, dependencies);
}
export const readUsageStatistics = createUsageStatisticsReader(registry.listSessionFiles);

export * from "@workbench/pi-sdk-sessions/history";
export * from "@workbench/pi-sdk-sessions/model-context";
export * from "@workbench/pi-sdk-sessions/context-trace";
export * from "@workbench/pi-sdk-sessions/interactive";
export * from "@workbench/pi-sdk-sessions/scratch";
export * from "@workbench/pi-sdk-sessions/protocol";
export * from "@workbench/pi-sdk-sessions/imports";
export * from "@workbench/pi-sdk-sessions/automation";
export * from "@workbench/pi-sdk-sessions/export";
export * from "@workbench/pi-sdk-sessions/usage";
export * from "@workbench/pi-sdk-sessions/execution";
export * from "@workbench/pi-sdk-sessions/threads";
