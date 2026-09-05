import { projectServiceCapabilityError } from "@workbench/services-client/errors";
import { RpcClientError } from "@workbench/host-client/rpc";
import type {
  WorkbenchAgentRuntimeCapabilities,
  WorkbenchServicesCapabilities,
  WorkbenchContextCapabilitySnapshot,
} from "@workbench/agent-runtime-client/capabilities";
import { WorkbenchAgentCapabilityError } from "@workbench/agent-runtime-client/capabilities";
import type {
  WorkbenchInteractionResponse,
  WorkbenchPendingInteraction,
} from "@workbench/agent-runtime-contracts/runtime-capabilities";

import type { PiPendingInteraction, PiSessionManager } from "../runtime/manager";
import {
  createPiWorkspace,
  describePiProjectTrust,
  listPiModelCatalog,
  listPiModelProviders,
  listPiRpcSessionModels,
  PiApiError,
  updatePiProjectTrust,
} from "../transport/api";

export function projectPiCapabilityError(error: unknown): WorkbenchAgentCapabilityError {
  if (error instanceof PiApiError && error.code === "pi_interaction_not_found")
    return new WorkbenchAgentCapabilityError(
      "request-ended",
      Object.keys(error.details).length ? Object.freeze({ ...error.details }) : undefined,
    );
  if (error instanceof PiApiError && error.code.startsWith("pi_rpc_")) {
    return projectServiceCapabilityError(new RpcClientError(error.code.slice(3), error.status));
  }
  return projectServiceCapabilityError(error);
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
        ...(interaction.expiresAt === undefined ? {} : { expiresAt: interaction.expiresAt }),
        ...(interaction.progress === undefined ? {} : { progress: interaction.progress }),
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
  services: WorkbenchServicesCapabilities,
): WorkbenchAgentRuntimeCapabilities {
  const options = manager.rpcTransportOptions;
  const contextSnapshotCache = new WeakMap<object, WorkbenchContextCapabilitySnapshot>();

  const capabilities: WorkbenchAgentRuntimeCapabilities = {
    host: {
      ...services.host,
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
      ...services.workspace,
    },
    models: {
      getCatalogRevision: manager.modelCatalogInvalidation.getRevision,
      subscribeCatalog: manager.modelCatalogInvalidation.subscribe,
      getSessionSelectionRevision: manager.modelCatalogInvalidation.getSessionSelectionRevision,
      subscribeSessionSelection: manager.modelCatalogInvalidation.subscribeSessionSelection,
      listCatalog: (request) =>
        capabilityCall(async () => {
          if (!request?.configuredOnly) return listPiModelCatalog(options);
          const [catalog, directory] = await Promise.all([
            listPiModelCatalog(options),
            listPiModelProviders(options),
          ]);
          const configured = new Map(
            directory.providers
              .filter(
                (provider) =>
                  provider.active && (provider.configured || provider.configurationDefined),
              )
              .map((provider) => [provider.provider, provider]),
          );
          return {
            ...catalog,
            groups: catalog.groups.flatMap((group) => {
              const provider = configured.get(group.id);
              return provider ? [{ ...group, name: provider.displayName || group.name }] : [];
            }),
          };
        }),
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
        const receipt = await capabilityCall(() =>
          manager.respondInteraction(
            requestId,
            response.kind === "question"
              ? {
                  ...response,
                  answers: response.answers.map((answer) => ({
                    ...answer,
                    selected: [...answer.selected],
                  })),
                }
              : response,
          ),
        );
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
    automation: services.automation,
    attachmentUnderstanding: services.attachmentUnderstanding,
  };
  return Object.freeze(capabilities);
}
