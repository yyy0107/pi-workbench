import type { WorkbenchAgentServerAdapter } from "@workbench/agent-runtime-server/adapter";

import {
  bindPiAgentHostBindings,
  CommandService,
  createPiAgentServerAdapter,
  shutdownPiPackageCatalogService,
  type PiAgentHostBindings,
} from "@workbench/agent-runtime-pi-server/installation";
import {
  cancelSession as cancelPiSession,
  createSession as createPiSession,
  deleteSession as deletePiSession,
  getSessionHistory as getPiSessionHistory,
  listModels as listPiModels,
  listSessions as listPiSessions,
  queuePrompt as queuePiPrompt,
  renameSession as renamePiSession,
  replacePromptQueue as replacePiPromptQueue,
  sendPrompt as sendPiPrompt,
  setPromptQueuePaused as setPiPromptQueuePaused,
  steerQueuedPrompt as steerPiQueuedPrompt,
} from "@workbench/agent-runtime-pi-server/legacy";
import {
  createRunningEventResponse as createPiRunningEventResponse,
  createSessionEventResponse as createPiSessionEventResponse,
  pickWorkspaceDirectory as pickPiWorkspaceDirectory,
} from "@workbench/agent-runtime-pi-server/legacy";
import {
  createDefaultPiRpcRouteGroups,
  createPiRpcRouter,
  createPiRuntimeHttpRouter,
  handleInteractiveResponsePost,
  handleSessionExportRequest as handlePiSessionExportRequest,
  handleWorkspaceFileContentRequest as handlePiWorkspaceFileContentRequest,
  type PiRpcPostHandler,
  type PiRuntimeHttpHandler,
} from "@workbench/agent-runtime-pi-server/http";
import { createWorkbenchBashToolOverride } from "@workbench/pi-terminal-tool";
import { runWorkbenchShutdownHooks } from "@workbench/server-core/shutdown-hooks";
import { subscribeWorkbenchSettingsPreferences } from "@workbench/settings-server/service";
import { createInstalledWorkbenchSettingsService } from "./installed-workbench-settings";
import { getInstalledPiAutomationService } from "./installed-automation";

export interface InstalledPiServer {
  readonly lifecycleVersion: 3;
  readonly agent: WorkbenchAgentServerAdapter;
  readonly handleRpcPost: PiRpcPostHandler;
  readonly handleHttpRequest: PiRuntimeHttpHandler;
  /** Releases process-lifetime resources owned by the installed Pi service graph. */
  dispose(): Promise<void>;
}

interface InstalledPiServerGlobal {
  __workbenchInstalledPiServer?: InstalledPiServerState;
}

interface InstalledPiServerState extends InstalledPiServer {
  readonly host: PiAgentHostBindings;
}

const installedGlobal = globalThis as typeof globalThis & InstalledPiServerGlobal;

export interface InstalledPiDisposalOwners {
  readonly shutdownPackageCatalog: () => Promise<void>;
  readonly automation: Pick<ReturnType<typeof getInstalledPiAutomationService>, "shutdown">;
  readonly runShutdownHooks?: () => Promise<unknown[]>;
}

export function createInstalledPiDisposer({
  shutdownPackageCatalog,
  automation,
  runShutdownHooks = runWorkbenchShutdownHooks,
}: InstalledPiDisposalOwners): () => Promise<void> {
  let disposeOperation: Promise<void> | undefined;
  return () => {
    if (disposeOperation) return disposeOperation;
    let resolveDispose!: () => void;
    let rejectDispose!: (error: unknown) => void;
    const operation = new Promise<void>((resolve, reject) => {
      resolveDispose = resolve;
      rejectDispose = reject;
    });
    disposeOperation = operation;
    void (async () => {
      const errors: unknown[] = [];
      try {
        await shutdownPackageCatalog();
      } catch (error) {
        errors.push(error);
      }
      try {
        await automation.shutdown();
      } catch (error) {
        errors.push(error);
      }
      try {
        errors.push(...(await runShutdownHooks()));
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, "Installed Pi service shutdown failed.");
      }
    })().then(resolveDispose, rejectDispose);
    return operation;
  };
}

function createInstalledPiRuntimeHttpHandler(
  handleRpcPost: PiRpcPostHandler,
): PiRuntimeHttpHandler {
  return createPiRuntimeHttpRouter({
    handleRpcPost,
    listModels: listPiModels,
    createRunningEventResponse: createPiRunningEventResponse,
    createSessionEventResponse: createPiSessionEventResponse,
    cancelSession: cancelPiSession,
    queuePrompt: queuePiPrompt,
    replacePromptQueue: replacePiPromptQueue,
    sendPrompt: sendPiPrompt,
    setPromptQueuePaused: setPiPromptQueuePaused,
    steerQueuedPrompt: steerPiQueuedPrompt,
    deleteSession: deletePiSession,
    getSessionHistory: getPiSessionHistory,
    renameSession: renamePiSession,
    createSession: createPiSession,
    listSessions: listPiSessions,
    pickWorkspaceDirectory: pickPiWorkspaceDirectory,
    handleSessionExportRequest: handlePiSessionExportRequest,
    handleWorkspaceFileContentRequest: handlePiWorkspaceFileContentRequest,
  });
}

function createInstalledPiAgentHostBindings(): PiAgentHostBindings {
  const settings = createInstalledWorkbenchSettingsService();
  return {
    createBashToolOverride({ cwd, sessionId, commandPrefix, shellPath }) {
      return createWorkbenchBashToolOverride(cwd, sessionId, {
        ...(commandPrefix === undefined ? {} : { commandPrefix }),
        ...(shellPath === undefined ? {} : { shellPath }),
      });
    },
    askUserSettings: {
      async readEnabled() {
        return (await settings.describe()).preferences.askUserEnabled !== false;
      },
      subscribe(listener) {
        return subscribeWorkbenchSettingsPreferences(settings.stateFile, (preferences) => {
          listener(preferences.askUserEnabled !== false);
        });
      },
    },
  };
}

function createInstalledPiServer(host: PiAgentHostBindings): InstalledPiServerState {
  const commands = new CommandService();
  const agent = createPiAgentServerAdapter({ commands, host });
  const automation = getInstalledPiAutomationService({ agentExecution: agent.execution });
  const routeGroups = createDefaultPiRpcRouteGroups({
    agent,
    commands,
    automation,
    getWorkbenchSettingsService: createInstalledWorkbenchSettingsService,
  });
  const handleRpcPost = createPiRpcRouter({
    routeGroups,
    respond: handleInteractiveResponsePost,
  });
  const dispose = createInstalledPiDisposer({
    shutdownPackageCatalog: shutdownPiPackageCatalogService,
    automation,
  });
  return Object.freeze({
    lifecycleVersion: 3 as const,
    agent,
    host,
    handleRpcPost,
    handleHttpRequest: createInstalledPiRuntimeHttpHandler(handleRpcPost),
    dispose,
  });
}

/** The only application composition boundary that installs Pi on the Workbench server. */
export function getInstalledPiServer(): InstalledPiServer {
  const current = installedGlobal.__workbenchInstalledPiServer;
  if (current) {
    bindPiAgentHostBindings(current.host);
    if (
      typeof current.handleHttpRequest !== "function" ||
      current.lifecycleVersion !== 3 ||
      typeof (current as Partial<InstalledPiServer>).dispose !== "function"
    ) {
      // A development module generation may retain the pre-Runtime-router frozen installation.
      // Upgrade only its transport/lifecycle facade; the Agent, RPC graph, registries and hubs stay
      // identical. Recover the already-installed Automation service instead of constructing a
      // second timer/repository owner.
      const automation = getInstalledPiAutomationService({
        agentExecution: current.agent.execution,
      });
      const upgraded = Object.freeze({
        ...current,
        lifecycleVersion: 3 as const,
        handleHttpRequest:
          typeof current.handleHttpRequest === "function"
            ? current.handleHttpRequest
            : createInstalledPiRuntimeHttpHandler(current.handleRpcPost),
        dispose: createInstalledPiDisposer({
          shutdownPackageCatalog: shutdownPiPackageCatalogService,
          automation,
        }),
      });
      installedGlobal.__workbenchInstalledPiServer = upgraded;
      return upgraded;
    }
    return current;
  }
  const host = createInstalledPiAgentHostBindings();
  const installed = createInstalledPiServer(host);
  installedGlobal.__workbenchInstalledPiServer = installed;
  return installed;
}

export function handlePiRpcPost(request: Request, method: string): Promise<Response> {
  return getInstalledPiServer().handleRpcPost(request, method);
}

export function listModels(...args: Parameters<typeof listPiModels>) {
  getInstalledPiServer();
  return listPiModels(...args);
}

export function createRunningEventResponse(
  ...args: Parameters<typeof createPiRunningEventResponse>
) {
  getInstalledPiServer();
  return createPiRunningEventResponse(...args);
}

export function createSessionEventResponse(
  ...args: Parameters<typeof createPiSessionEventResponse>
) {
  getInstalledPiServer();
  return createPiSessionEventResponse(...args);
}

export function cancelSession(...args: Parameters<typeof cancelPiSession>) {
  getInstalledPiServer();
  return cancelPiSession(...args);
}

export function queuePrompt(...args: Parameters<typeof queuePiPrompt>) {
  getInstalledPiServer();
  return queuePiPrompt(...args);
}

export function replacePromptQueue(...args: Parameters<typeof replacePiPromptQueue>) {
  getInstalledPiServer();
  return replacePiPromptQueue(...args);
}

export function sendPrompt(...args: Parameters<typeof sendPiPrompt>) {
  getInstalledPiServer();
  return sendPiPrompt(...args);
}

export function setPromptQueuePaused(...args: Parameters<typeof setPiPromptQueuePaused>) {
  getInstalledPiServer();
  return setPiPromptQueuePaused(...args);
}

export function steerQueuedPrompt(...args: Parameters<typeof steerPiQueuedPrompt>) {
  getInstalledPiServer();
  return steerPiQueuedPrompt(...args);
}

export function deleteSession(...args: Parameters<typeof deletePiSession>) {
  getInstalledPiServer();
  return deletePiSession(...args);
}

export function getSessionHistory(...args: Parameters<typeof getPiSessionHistory>) {
  getInstalledPiServer();
  return getPiSessionHistory(...args);
}

export function renameSession(...args: Parameters<typeof renamePiSession>) {
  getInstalledPiServer();
  return renamePiSession(...args);
}

export function createSession(...args: Parameters<typeof createPiSession>) {
  getInstalledPiServer();
  return createPiSession(...args);
}

export function listSessions(...args: Parameters<typeof listPiSessions>) {
  getInstalledPiServer();
  return listPiSessions(...args);
}

export function pickWorkspaceDirectory(...args: Parameters<typeof pickPiWorkspaceDirectory>) {
  getInstalledPiServer();
  return pickPiWorkspaceDirectory(...args);
}

export function handleSessionExportRequest(
  ...args: Parameters<typeof handlePiSessionExportRequest>
) {
  getInstalledPiServer();
  return handlePiSessionExportRequest(...args);
}

export function handleWorkspaceFileContentRequest(
  ...args: Parameters<typeof handlePiWorkspaceFileContentRequest>
) {
  getInstalledPiServer();
  return handlePiWorkspaceFileContentRequest(...args);
}
