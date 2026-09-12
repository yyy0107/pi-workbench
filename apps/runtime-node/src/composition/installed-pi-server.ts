import { builtinToolEnabled } from "@workbench/agent-runtime-contracts/settings";
import { BrowserManager } from "@workbench/browser-server";
import applicationPackage from "../../package.json" with { type: "json" };

import { createRuntimeHttpRouter } from "./runtime-http-router";
import { createWorkbenchSettingsRpcRoutes } from "@workbench/settings-server/rpc";
import { createAutomationRpcRoutes } from "@workbench/automation-server/rpc";
import { projectRpcDomainError } from "@workbench/host-server/rpc";
import { localHostService } from "@workbench/local-host-server/service";
import { LocalAppService } from "@workbench/local-host-server/applications";
import {
  createLocalHostRpcRoutes,
  createLocalAppRpcRoutes,
} from "@workbench/local-host-server/rpc";
import {
  createWorkspaceFileService,
  type WorkspaceFileService,
} from "@workbench/workspace-server/files";
import { createWorkspaceGitService } from "@workbench/workspace-server/git";
import {
  createLocalFileContentHandler,
  createWorkspaceFileContentHandler,
} from "@workbench/workspace-server/http";
import { LocalFileService } from "@workbench/workspace-server/local-files";
import {
  createWorkspaceFileRpcRoutes,
  createLocalFileRpcRoutes,
  createWorkspaceGitRpcRoutes,
} from "@workbench/workspace-server/rpc";
import type { WorkbenchAgentServerAdapter } from "@workbench/agent-runtime-server/adapter";

import {
  bindPiAgentHostBindings,
  resolvePiWorkspaceRoot,
  resolvePiReviewSnapshots,
  resolvePiWorkspaceId,
  mutatePiWorkspace,
  CommandService,
  createPiAgentServerImplementation,
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
  type PiRpcPostHandler,
  type PiRuntimeHttpHandler,
} from "@workbench/agent-runtime-pi-server/http";
import { createWorkbenchBashToolOverride } from "@workbench/pi-terminal-tool";
import { createTerminalShellPreference } from "@workbench/terminal-server/shell";
import { ToolTerminalSessionManager } from "@workbench/terminal-server/tool-sessions";
import { runWorkbenchShutdownHooks } from "@workbench/server-core/shutdown-hooks";
import { subscribeWorkbenchSettingsPreferences } from "@workbench/settings-server/service";
import {
  createInstalledWorkbenchSettingsAgentAccess,
  createInstalledWorkbenchSettingsService,
} from "./installed-workbench-settings";
import { getInstalledPiAutomationService } from "./installed-automation";

export interface InstalledPiServer {
  readonly lifecycleVersion: 7;
  readonly browser: BrowserManager;
  readonly terminalShell: ReturnType<typeof createTerminalShellPreference>;
  readonly toolTerminalSessions: ToolTerminalSessionManager;
  readonly agent: WorkbenchAgentServerAdapter;
  readonly handleRpcPost: PiRpcPostHandler;
  readonly handleHttpRequest: PiRuntimeHttpHandler;
  readonly handleWorkspaceFileContentRequest: PiRuntimeHttpHandler;
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
  handleWorkspaceFileContentRequest: PiRuntimeHttpHandler,
  handleLocalFileContentRequest: PiRuntimeHttpHandler,
): PiRuntimeHttpHandler {
  const handlePiRequest = createPiRuntimeHttpRouter({
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
  });
  return createRuntimeHttpRouter({
    handleRpcPost,
    handleWorkspaceFileContentRequest,
    handleLocalFileContentRequest,
    handlePiRequest,
  });
}

function createInstalledPiAgentHostBindings(
  workspaceFiles: WorkspaceFileService,
  terminalShell: ReturnType<typeof createTerminalShellPreference>,
  toolTerminalSessions: ToolTerminalSessionManager,
  browser: BrowserManager,
): PiAgentHostBindings {
  const settings = createInstalledWorkbenchSettingsService();
  return {
    browser: {
      command: (command, signal, controlSignal) =>
        browser.handle(command, { source: "agent", signal, controlSignal }),
      resolveProjectId: async (cwd) => (await resolvePiWorkspaceId(cwd)) ?? cwd,
    },
    workbenchSettings: createInstalledWorkbenchSettingsAgentAccess(),
    workspaceFiles,
    getDefaultTerminalShell: terminalShell.getShell,
    async readSessionPreferences() {
      const { preferences } = await settings.describe();
      return {
        enhancedSearch: preferences.enhancedSearch === true,
        retainAllModelIO: preferences.retainAllModelIO === true,
      };
    },
    createBashToolOverride({ cwd, sessionId, commandPrefix, shellPath }) {
      return createWorkbenchBashToolOverride(
        cwd,
        sessionId,
        {
          ...(commandPrefix === undefined ? {} : { commandPrefix }),
          ...(shellPath === undefined ? {} : { shellPath }),
        },
        toolTerminalSessions,
      );
    },
    async readBuiltinResourceEnabled(key) {
      return (await settings.describe()).preferences[key] !== false;
    },
    builtinToolSettings(name) {
      return {
        async readEnabled() {
          return builtinToolEnabled(name, (await settings.describe()).preferences);
        },
        subscribe(listener) {
          return subscribeWorkbenchSettingsPreferences(settings.stateFile, (preferences) => {
            listener(builtinToolEnabled(name, preferences));
          });
        },
      };
    },
    todoSettings: {
      async readEnabled() {
        return (await settings.describe()).preferences.todoEnabled === true;
      },
      subscribe(listener) {
        return subscribeWorkbenchSettingsPreferences(settings.stateFile, (preferences) => {
          listener(preferences.todoEnabled === true);
        });
      },
    },
    workbenchSettingsToolSettings: {
      async readEnabled() {
        return (await settings.describe()).preferences.workbenchSettingsEnabled === true;
      },
      subscribe(listener) {
        return subscribeWorkbenchSettingsPreferences(settings.stateFile, (preferences) => {
          listener(preferences.workbenchSettingsEnabled === true);
        });
      },
    },
    askUserSettings: {
      async readAutoContinue() {
        return (await settings.describe()).preferences.askUserAutoContinue !== false;
      },
      subscribeAutoContinue(listener) {
        let active = true;
        let changed = false;
        const unsubscribe = subscribeWorkbenchSettingsPreferences(
          settings.stateFile,
          (preferences) => {
            changed = true;
            listener(preferences.askUserAutoContinue !== false);
          },
        );
        // Close the race between the request's initial read and subscribing its live timer.
        void settings
          .describe()
          .then(({ preferences }) => {
            if (active && !changed) listener(preferences.askUserAutoContinue !== false);
          })
          .catch(() => {});
        return () => {
          active = false;
          unsubscribe();
        };
      },
      async readEnabled() {
        return (await settings.describe()).preferences.askUserEnabled === true;
      },
      subscribe(listener) {
        return subscribeWorkbenchSettingsPreferences(settings.stateFile, (preferences) => {
          listener(preferences.askUserEnabled === true);
        });
      },
    },
  };
}

function createInstalledPiServer(
  existingAgent?: WorkbenchAgentServerAdapter,
): InstalledPiServerState {
  const workspaceFiles = createWorkspaceFileService({
    resolveWorkspaceRoot: resolvePiWorkspaceRoot,
  });
  const localFiles = new LocalFileService();
  const workspaceGit = createWorkspaceGitService({
    resolveWorkspaceRoot: resolvePiWorkspaceRoot,
    mutateWorkspace: mutatePiWorkspace,
    resolveReviewSnapshots: resolvePiReviewSnapshots,
  });
  const terminalShell = createTerminalShellPreference();
  const toolTerminalSessions = new ToolTerminalSessionManager({ getShell: terminalShell.getShell });
  const browser = new BrowserManager();
  const host = createInstalledPiAgentHostBindings(
    workspaceFiles,
    terminalShell,
    toolTerminalSessions,
    browser,
  );
  bindPiAgentHostBindings(host);
  const commands = new CommandService();
  const agent = existingAgent ?? createPiAgentServerImplementation({ commands, host });
  const automation = getInstalledPiAutomationService({ agentExecution: agent.execution });
  const domainErrors = { projectDomainError: projectRpcDomainError };
  const routeGroups = [
    createWorkspaceGitRpcRoutes({ service: workspaceGit, ...domainErrors }),
    createWorkspaceFileRpcRoutes({ service: workspaceFiles, ...domainErrors }),
    createLocalFileRpcRoutes({ service: localFiles, ...domainErrors }),
    createAutomationRpcRoutes({ service: automation, ...domainErrors }),
    createWorkbenchSettingsRpcRoutes({
      getService: createInstalledWorkbenchSettingsService,
      openDocument: localHostService.openPath,
      ...domainErrors,
    }),
    createLocalHostRpcRoutes({ service: localHostService, ...domainErrors }),
    createLocalAppRpcRoutes({ service: new LocalAppService(), ...domainErrors }),
    ...createDefaultPiRpcRouteGroups({
      agent,
      commands,
      applicationVersion: applicationPackage.version,
      openDocument: localHostService.openPath,
    }),
  ];
  const handleWorkspaceFileContentRequest = createWorkspaceFileContentHandler(workspaceFiles);
  const handleRpcPost = createPiRpcRouter({
    routeGroups,
    respond: handleInteractiveResponsePost,
  });
  const dispose = createInstalledPiDisposer({
    shutdownPackageCatalog: shutdownPiPackageCatalogService,
    automation,
  });
  return Object.freeze({
    lifecycleVersion: 7 as const,
    browser,
    terminalShell,
    toolTerminalSessions,
    agent,
    host,
    handleRpcPost,
    handleWorkspaceFileContentRequest,
    handleHttpRequest: createInstalledPiRuntimeHttpHandler(
      handleRpcPost,
      handleWorkspaceFileContentRequest,
      createLocalFileContentHandler(localFiles),
    ),
    dispose,
  });
}

/** The only application composition boundary that installs Pi on the Workbench server. */
export function getInstalledPiServer(): InstalledPiServer {
  const current = installedGlobal.__workbenchInstalledPiServer;
  if (current) {
    bindPiAgentHostBindings(current.host);
    if (current.lifecycleVersion !== 7) {
      const upgraded = createInstalledPiServer(current.agent);
      installedGlobal.__workbenchInstalledPiServer = upgraded;
      return upgraded;
    }
    return current;
  }
  const installed = createInstalledPiServer();
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

export function handleWorkspaceFileContentRequest(request: Request): Promise<Response> {
  return getInstalledPiServer().handleWorkspaceFileContentRequest(request);
}
