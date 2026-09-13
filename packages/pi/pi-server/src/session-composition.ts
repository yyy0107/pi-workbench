import * as registry from "./session-composition/registry";
import { getWorkspaceStore } from "./workspaces/workspace-registry";
import { getStreamHub } from "./streams/stream-hub";
import { ModelService } from "@workbench/pi-model-server";
import { getProjectTrustService } from "@workbench/pi-resources-server/trust";
import {
  getSessionContextTrace,
  readSessionContextTracePromptParts,
} from "@workbench/pi-session-server/session-context-trace";
import * as Interactive from "@workbench/pi-session-server/interactive";
import * as Scratch from "@workbench/pi-session-server/scratch";
import * as Protocol from "@workbench/pi-session-server/protocol";
import * as Imports from "@workbench/pi-session-server/imports";
import * as Automation from "@workbench/pi-session-server/automation";
import * as Export from "@workbench/pi-session-server/export";
import { createUsageStatisticsReader } from "@workbench/pi-session-server/usage";
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
import * as PiSessionHistoryServiceModule from "@workbench/pi-session-server/history";
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
import * as PiSessionModelContextServiceModule from "@workbench/pi-session-server/model-context";
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
import * as PiSessionContextTraceServiceModule from "@workbench/pi-session-server/context-trace";
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
import * as PiAgentExecutionModule from "@workbench/pi-session-server/execution";
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
import * as PiAgentThreadStoreModule from "@workbench/pi-session-server/threads";
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

export * from "@workbench/pi-session-server/history";
export * from "@workbench/pi-session-server/model-context";
export * from "@workbench/pi-session-server/context-trace";
export * from "@workbench/pi-session-server/interactive";
export * from "@workbench/pi-session-server/scratch";
export * from "@workbench/pi-session-server/protocol";
export * from "@workbench/pi-session-server/imports";
export * from "@workbench/pi-session-server/automation";
export * from "@workbench/pi-session-server/export";
export * from "@workbench/pi-session-server/usage";
export * from "@workbench/pi-session-server/execution";
export * from "@workbench/pi-session-server/threads";
