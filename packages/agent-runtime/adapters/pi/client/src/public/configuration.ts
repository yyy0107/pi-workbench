"use client";

import { useMemo } from "react";
import type { SessionSelectModelPayload } from "@workbench/agent-runtime-pi-protocol/rpc";

import { usePiSessionManager } from "../runtime/context";
import {
  cancelPiModelProviderLogin,
  configurePiModelProvider,
  describeAttachmentUnderstandingSettings,
  describePiSettings,
  describeWorkbenchSettings,
  discoverPiModels,
  getPiModelContextWindow,
  getPiModelProviderConfig,
  getPiModelProviderLogin,
  listPiModelCatalog,
  listPiModelProviders,
  listPiRpcSessionModels,
  openPiSettingsDocument,
  openWorkbenchSettingsDocument,
  removePiModelProvider,
  resetPiModelContextWindow,
  respondPiModelProviderLogin,
  selectPiRpcSessionModel,
  startPiModelProviderLogin,
  testPiModelImageInput,
  updateAttachmentUnderstandingSettings,
  updatePiAgentSettings,
  updatePiModelContextWindow,
  updateWorkbenchSettings,
} from "../transport/api";

export {
  cancelPiModelProviderLogin,
  compactPiRpcSessionContext,
  configurePiModelProvider,
  describeAttachmentUnderstandingSettings,
  describeImageUnderstandingSettings,
  describePiSettings,
  describeWorkbenchSettings,
  discoverPiModels,
  getPiModelContextWindow,
  getPiModelProviderConfig,
  getPiModelProviderLogin,
  getPiRpcSessionContextPolicy,
  listPiModelCatalog,
  listPiModelProviders,
  listPiRpcSessionModels,
  openPiSettingsDocument,
  openWorkbenchSettingsDocument,
  removePiModelProvider,
  resetPiModelContextWindow,
  respondPiModelProviderLogin,
  selectPiRpcSessionModel,
  startPiModelProviderLogin,
  testPiModelImageInput,
  updateAttachmentUnderstandingSettings,
  updateImageUnderstandingSettings,
  updatePiAgentSettings,
  updatePiModelContextWindow,
  updatePiRpcSessionContextPolicy,
  updateWorkbenchSettings,
} from "../transport/api";
export { toWorkbenchSettingsJsonObject } from "../settings/workbench-settings-client";
export { useSessionContextPolicy } from "../context-policy/use-session-context-policy";

export interface PiModelSessionClient {
  reloadSession(localThreadId: string, remoteSessionId: string): Promise<void>;
  setDraftSelection(
    localThreadId: string,
    selection: Omit<SessionSelectModelPayload, "sessionId"> | undefined,
  ): void;
}

export function usePiModelSessionClient(): PiModelSessionClient {
  const manager = usePiSessionManager();
  return useMemo(
    () => ({
      reloadSession: async (localThreadId: string, remoteSessionId: string) => {
        await manager.getSession(localThreadId, remoteSessionId).reload();
      },
      setDraftSelection: (localThreadId, selection) => {
        manager.getSession(localThreadId).setDraftModelSelection(selection);
      },
    }),
    [manager],
  );
}

/** Bind configuration RPC to the current installation without exposing Host connection details. */
export function usePiConfigurationClient() {
  const manager = usePiSessionManager();
  return useMemo(() => {
    const options = manager.rpcTransportOptions;
    return {
      getModelCatalogRevision: manager.modelCatalogInvalidation.getRevision,
      subscribeModelCatalog: manager.modelCatalogInvalidation.subscribe,
      getSessionModelSelectionRevision:
        manager.modelCatalogInvalidation.getSessionSelectionRevision,
      subscribeSessionModelSelection: manager.modelCatalogInvalidation.subscribeSessionSelection,
      loadWorkbenchSettingsPreferences: manager.workbenchSettings.load,
      updateWorkbenchSettingsPreferences: manager.workbenchSettings.update,
      listModelProviders: () => listPiModelProviders(options),
      getModelProviderConfig: (payload: Parameters<typeof getPiModelProviderConfig>[0]) =>
        getPiModelProviderConfig(payload, options),
      startModelProviderLogin: (payload: Parameters<typeof startPiModelProviderLogin>[0]) =>
        startPiModelProviderLogin(payload, options),
      getModelProviderLogin: (payload: Parameters<typeof getPiModelProviderLogin>[0]) =>
        getPiModelProviderLogin(payload, options),
      respondModelProviderLogin: (payload: Parameters<typeof respondPiModelProviderLogin>[0]) =>
        respondPiModelProviderLogin(payload, options),
      cancelModelProviderLogin: (payload: Parameters<typeof cancelPiModelProviderLogin>[0]) =>
        cancelPiModelProviderLogin(payload, options),
      getModelContextWindow: (payload: Parameters<typeof getPiModelContextWindow>[0]) =>
        getPiModelContextWindow(payload, options),
      updateModelContextWindow: (payload: Parameters<typeof updatePiModelContextWindow>[0]) =>
        updatePiModelContextWindow(payload, options),
      resetModelContextWindow: (payload: Parameters<typeof resetPiModelContextWindow>[0]) =>
        resetPiModelContextWindow(payload, options),
      configureModelProvider: (payload: Parameters<typeof configurePiModelProvider>[0]) =>
        configurePiModelProvider(payload, options),
      removeModelProvider: (payload: Parameters<typeof removePiModelProvider>[0]) =>
        removePiModelProvider(payload, options),
      listModelCatalog: () => listPiModelCatalog(options),
      discoverModels: (payload: Parameters<typeof discoverPiModels>[0]) =>
        discoverPiModels(payload, options),
      testModelImageInput: (payload: Parameters<typeof testPiModelImageInput>[0]) =>
        testPiModelImageInput(payload, options),
      describeAgentSettings: () => describePiSettings(options),
      updateAgentSettings: (payload: Parameters<typeof updatePiAgentSettings>[0]) =>
        updatePiAgentSettings(payload, options),
      describeWorkbenchSettings: () => describeWorkbenchSettings(options),
      updateWorkbenchSettings: (payload: Parameters<typeof updateWorkbenchSettings>[0]) =>
        updateWorkbenchSettings(payload, options),
      openAgentSettingsDocument: () => openPiSettingsDocument(options),
      openWorkbenchSettingsDocument: () => openWorkbenchSettingsDocument(options),
      describeAttachmentUnderstandingSettings: () =>
        describeAttachmentUnderstandingSettings(options),
      updateAttachmentUnderstandingSettings: (
        payload: Parameters<typeof updateAttachmentUnderstandingSettings>[0],
      ) => updateAttachmentUnderstandingSettings(payload, options),
      listSessionModels: (payload: Parameters<typeof listPiRpcSessionModels>[0]) =>
        listPiRpcSessionModels(payload, options),
      selectSessionModel: (payload: Parameters<typeof selectPiRpcSessionModel>[0]) =>
        manager.selectSessionModel(payload),
      waitForPendingSessionModelSelection: (sessionId: string) =>
        manager.waitForPendingSessionModelSelection(sessionId),
    };
  }, [manager]);
}
