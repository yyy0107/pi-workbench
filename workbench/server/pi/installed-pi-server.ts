import { createInstalledWorkbenchAgentServerAdapter } from "@workbench/agent-runtime-server/installation";
import type { WorkbenchAgentServerAdapter } from "@workbench/agent-runtime-server/adapter";

import {
  bindPiAgentHostBindings,
  CommandService,
  createPiAgentServerInstallation,
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
  handleInteractiveResponsePost,
  handleSessionExportRequest as handlePiSessionExportRequest,
  handleWorkspaceFileContentRequest as handlePiWorkspaceFileContentRequest,
  type PiRpcPostHandler,
} from "@workbench/agent-runtime-pi-server/http";
import { createWorkbenchBashToolOverride } from "@/runtime/terminal/server/interactive-bash-tool";
import { subscribeWorkbenchSettingsPreferences } from "@/runtime/server/settings/workbench-settings-service";
import { createInstalledWorkbenchSettingsService } from "../workbench-settings";
import { getInstalledPiAutomationService } from "./installed-automation";
import { getInstalledPiExecutionService } from "./installed-execution";

export interface InstalledPiServer {
  readonly agent: WorkbenchAgentServerAdapter;
  readonly handleRpcPost: PiRpcPostHandler;
}

interface InstalledPiServerGlobal {
  __workbenchInstalledPiServer?: InstalledPiServerState;
}

interface InstalledPiServerState extends InstalledPiServer {
  readonly host: PiAgentHostBindings;
}

const installedGlobal = globalThis as typeof globalThis & InstalledPiServerGlobal;

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
  const agent = createInstalledWorkbenchAgentServerAdapter(
    createPiAgentServerInstallation({ commands, host }),
  );
  const automation = getInstalledPiAutomationService({ agentExecution: agent.execution });
  const execution = getInstalledPiExecutionService({ execution: agent.execution });
  const routeGroups = createDefaultPiRpcRouteGroups({
    agent,
    commands,
    automation,
    execution,
    getWorkbenchSettingsService: createInstalledWorkbenchSettingsService,
  });
  return Object.freeze({
    agent,
    host,
    handleRpcPost: createPiRpcRouter({
      routeGroups,
      respond: handleInteractiveResponsePost,
    }),
  });
}

/** The only application composition boundary that installs Pi on the Workbench server. */
export function getInstalledPiServer(): InstalledPiServer {
  const current = installedGlobal.__workbenchInstalledPiServer;
  if (current) {
    bindPiAgentHostBindings(current.host);
    return current;
  }
  const host = createInstalledPiAgentHostBindings();
  bindPiAgentHostBindings(host);
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
