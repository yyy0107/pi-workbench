import type {
  WorkbenchAgentRuntimeCapabilities,
  WorkbenchAgentCapabilityErrorCode,
  WorkbenchContextCapabilitySnapshot,
} from "@workbench/agent-runtime-client/capabilities";
import { WorkbenchAgentCapabilityError } from "@workbench/agent-runtime-client/capabilities";
import type {
  WorkbenchInteractionResponse,
  WorkbenchPendingInteraction,
} from "@workbench/agent-runtime-contracts/runtime-capabilities";

import { createAutomationClient } from "../automations/automation-client";
import type { PiPendingInteraction, PiSessionManager } from "../runtime/manager";
import {
  createPiHostDirectory,
  createPiWorkspace,
  createPiWorkspaceGitBranch,
  describeAttachmentUnderstandingSettings,
  describePiProjectTrust,
  describePiWorkspaceFile,
  describePiWorkspaceGit,
  fetchPiWorkspaceFileContent,
  listPiHostDirectory,
  listPiLocalApps,
  listPiModelCatalog,
  listPiRpcSessionModels,
  listPiWorkspaceFiles,
  openPiHostPath,
  openPiLocalApp,
  PiApiError,
  pickPiHostDirectory,
  piWorkspaceFileContentUrl,
  readPiWorkspaceFile,
  readPiWorkspaceGitLog,
  searchPiWorkspaceFiles,
  streamPiWorkspaceFileText,
  switchPiWorkspaceGitBranch,
  updateAttachmentUnderstandingSettings,
  updatePiProjectTrust,
  writePiWorkspaceFile,
} from "../transport/api";

function errorCode(error: PiApiError): WorkbenchAgentCapabilityErrorCode {
  const code = error.code;
  if (code === "pi_interaction_not_found") return "request-ended";
  if (code === "pi_rpc_invalid_response") return "failed";
  if (/busy|in-progress|running/u.test(code)) return "busy";
  if (/conflict|exists|stale/u.test(code)) return "conflict";
  if (/not[-_]found/u.test(code)) return "not-found";
  if (/unavailable|unsupported|readonly/u.test(code)) return "unavailable";
  if (/invalid|bad-request|mismatch/u.test(code)) return "invalid-request";
  if (/forbidden|permission/u.test(code) || error.status === 401 || error.status === 403) {
    return "permission-denied";
  }
  if (/cancelled|canceled/u.test(code)) return "cancelled";
  if (/transport/u.test(code)) return "unavailable";
  if (error.status === 404) return "not-found";
  if (error.status === 409) return "conflict";
  if (error.status === 429) return "busy";
  if ([501, 502, 503, 504].includes(error.status)) return "unavailable";
  if (error.status === 400 || error.status === 422) return "invalid-request";
  return "failed";
}

/** Translate concrete Pi failures once, before a capability reaches Workbench UI. */
export function projectPiCapabilityError(error: unknown): WorkbenchAgentCapabilityError {
  if (error instanceof WorkbenchAgentCapabilityError) return error;
  if (error instanceof PiApiError) {
    const details =
      !error.code.startsWith("pi_rpc_") && Object.keys(error.details).length
        ? Object.freeze({ ...error.details })
        : undefined;
    return new WorkbenchAgentCapabilityError(errorCode(error), details);
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new WorkbenchAgentCapabilityError("cancelled");
  }
  return new WorkbenchAgentCapabilityError("failed");
}

async function capabilityCall<Value>(operation: () => Promise<Value>): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    throw projectPiCapabilityError(error);
  }
}

function projectPendingInteraction(interaction: PiPendingInteraction): WorkbenchPendingInteraction {
  return interaction.kind === "question"
    ? {
        kind: "question",
        requestId: interaction.rpcId,
        sessionId: interaction.sessionId,
        questions: interaction.questions,
      }
    : {
        kind: "approval",
        requestId: interaction.rpcId,
        sessionId: interaction.sessionId,
        approvalId: interaction.approvalId,
        toolName: interaction.toolName,
        ...(interaction.callId === undefined ? {} : { callId: interaction.callId }),
        ...(interaction.reason === undefined ? {} : { reason: interaction.reason }),
      };
}

/** Assemble the direct Workbench capability fields for one Pi manager. */
export function createPiAgentRuntimeCapabilities(
  manager: PiSessionManager,
): WorkbenchAgentRuntimeCapabilities {
  const options = manager.rpcTransportOptions;
  const automation = createAutomationClient(options);
  const contextSnapshotCache = new WeakMap<object, WorkbenchContextCapabilitySnapshot>();

  const capabilities: WorkbenchAgentRuntimeCapabilities = {
    host: {
      pickDirectory: () => capabilityCall(() => pickPiHostDirectory(options)),
      listDirectory: (path?: string) => capabilityCall(() => listPiHostDirectory(path, options)),
      createDirectory: async (path: string, name: string) =>
        (await capabilityCall(() => createPiHostDirectory(path, name, options))).path,
      openPath: async (path: string) => {
        await capabilityCall(() => openPiHostPath(path, options));
      },
      listLocalApps: async () => (await capabilityCall(() => listPiLocalApps(options))).apps,
      openLocalApp: async (request) => {
        await capabilityCall(() => openPiLocalApp(request, options));
      },
      describeProjectTrust: (path: string) =>
        capabilityCall(() => describePiProjectTrust({ path }, options)),
      updateProjectTrust: (path: string, trusted: boolean) =>
        capabilityCall(() => updatePiProjectTrust({ path, trusted }, options)),
    },
    workspace: {
      createWorkspace: async (rootPath: string) => {
        const result = await capabilityCall(() => createPiWorkspace(rootPath, options));
        return {
          created: result.created,
          workspace: {
            id: result.workspace.workspaceId,
            name: result.workspace.title,
            rootPath: result.workspace.path,
          },
        };
      },
      listFiles: (request) => capabilityCall(() => listPiWorkspaceFiles(request, options)),
      searchFiles: (request, requestOptions) =>
        capabilityCall(() => searchPiWorkspaceFiles(request, { ...options, ...requestOptions })),
      describeFile: (request) => capabilityCall(() => describePiWorkspaceFile(request, options)),
      fileContentUrl: piWorkspaceFileContentUrl,
      fetchFileContent: (request, requestOptions) =>
        capabilityCall(() =>
          fetchPiWorkspaceFileContent(request, { ...options, ...requestOptions }),
        ),
      readFile: (request) => capabilityCall(() => readPiWorkspaceFile(request, options)),
      writeFile: (request) => capabilityCall(() => writePiWorkspaceFile(request, options)),
      streamFileText: (request, streamOptions) =>
        capabilityCall(() =>
          streamPiWorkspaceFileText(request, {
            ...streamOptions,
            transport: options.transport,
          }),
        ),
      describeGit: (workspaceId, requestOptions) =>
        capabilityCall(() =>
          describePiWorkspaceGit({ workspaceId }, { ...options, ...requestOptions }),
        ),
      readGitLog: (workspaceId, requestOptions) =>
        capabilityCall(() =>
          readPiWorkspaceGitLog({ workspaceId }, { ...options, ...requestOptions }),
        ),
      switchGitBranch: (workspaceId, branch) =>
        capabilityCall(() => switchPiWorkspaceGitBranch({ workspaceId, branch }, options)),
      createGitBranch: (workspaceId, branch) =>
        capabilityCall(() => createPiWorkspaceGitBranch({ workspaceId, branch }, options)),
    },
    models: {
      getCatalogRevision: manager.modelCatalogInvalidation.getRevision,
      subscribeCatalog: manager.modelCatalogInvalidation.subscribe,
      getSessionSelectionRevision: manager.modelCatalogInvalidation.getSessionSelectionRevision,
      subscribeSessionSelection: manager.modelCatalogInvalidation.subscribeSessionSelection,
      listCatalog: () => capabilityCall(() => listPiModelCatalog(options)),
      listSessionModels: (sessionId) =>
        capabilityCall(() => listPiRpcSessionModels({ sessionId }, options)),
      selectSessionModel: async (sessionId, selection) =>
        (await capabilityCall(() => manager.selectSessionModel({ sessionId, ...selection })))
          .selected,
      setDraftSelection: (sessionId, selection) => {
        try {
          const session = manager.session(sessionId);
          if (!session) throw new WorkbenchAgentCapabilityError("not-found");
          session.setDraftModelSelection(selection);
        } catch (error) {
          throw projectPiCapabilityError(error);
        }
      },
      reloadSession: async (sessionId) => {
        const session = manager.session(sessionId);
        if (!session) throw new WorkbenchAgentCapabilityError("not-found");
        await capabilityCall(() => session.reload());
      },
    },
    interactions: {
      getRevision: manager.getSnapshot,
      subscribe: manager.subscribe,
      getPendingInteractions: (sessionId) =>
        manager.getPendingInteractions(sessionId).map(projectPendingInteraction),
      respondInteraction: async (requestId, response: WorkbenchInteractionResponse) => {
        const receipt = await capabilityCall(() => manager.respondInteraction(requestId, response));
        if (receipt.accepted) return;
        throw new WorkbenchAgentCapabilityError(
          receipt.reason === "not-pending" ? "request-ended" : "invalid-request",
        );
      },
    },
    scratchSessions: {
      createScratchSession: (request) =>
        capabilityCall(() => manager.createScratchSession(request)),
      restoreScratchSession: (session) => {
        try {
          return manager.restoreScratchSession(session);
        } catch (error) {
          throw projectPiCapabilityError(error);
        }
      },
      releaseScratchSession: (sessionId) =>
        capabilityCall(() => manager.releaseScratchSession(sessionId)),
      promoteScratchSession: (request) =>
        capabilityCall(() => manager.promoteScratchSession(request)),
    },
    context: {
      getSnapshot: (sessionId) => {
        const snapshot = manager.contextPolicies.getSnapshot(sessionId);
        const cached = contextSnapshotCache.get(snapshot);
        if (cached) return cached;
        const projected: WorkbenchContextCapabilitySnapshot = {
          status: snapshot.status,
          ...(snapshot.value === undefined ? {} : { value: snapshot.value }),
          ...(snapshot.error === undefined
            ? {}
            : { error: projectPiCapabilityError(snapshot.error) }),
        };
        contextSnapshotCache.set(snapshot, projected);
        return projected;
      },
      subscribe: manager.contextPolicies.subscribe,
      load: (sessionId, force) =>
        capabilityCall(() => manager.contextPolicies.load(sessionId, force)),
      update: (sessionId, policy) =>
        capabilityCall(() => manager.contextPolicies.update(sessionId, policy)),
      compact: (sessionId) => capabilityCall(() => manager.contextPolicies.compact(sessionId)),
    },
    automation: {
      list: (request) => capabilityCall(() => automation.list(request)),
      read: (request) => capabilityCall(() => automation.read(request)),
      save: (request) => capabilityCall(() => automation.save(request)),
      archive: (request) => capabilityCall(() => automation.archive(request)),
      setEnabled: (request) => capabilityCall(() => automation.setEnabled(request)),
      runNow: (request) => capabilityCall(() => automation.runNow(request)),
      sessions: (request) => capabilityCall(() => automation.sessions(request)),
      removeSession: (request) => capabilityCall(() => automation.removeSession(request)),
    },
    attachmentUnderstanding: {
      describe: () => capabilityCall(() => describeAttachmentUnderstandingSettings(options)),
      update: (request) =>
        capabilityCall(() => updateAttachmentUnderstandingSettings(request, options)),
    },
  };
  return Object.freeze(capabilities);
}
