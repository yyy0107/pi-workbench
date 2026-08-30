"use client";

import { useMemo } from "react";

import { usePiSessionManager } from "../runtime/context";

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
  waitForPendingPiRpcSessionModelSelection,
} from "../transport/api";
export {
  loadWorkbenchSettingsPreferences,
  toWorkbenchSettingsJsonObject,
  updateWorkbenchSettingsPreferences,
} from "../settings/workbench-settings-client";
export {
  getPiModelCatalogRevision,
  getPiSessionModelSelectionRevision,
  invalidatePiModelCatalog,
  invalidatePiSessionModelSelection,
  subscribePiModelCatalogInvalidation,
  subscribePiSessionModelSelectionInvalidation,
} from "../models/model-catalog-invalidation";
export { draftSessionModelSelection } from "../models/model-selection";
export type { DraftSessionModelSelection } from "../models/model-selection";
export { useSessionContextPolicy } from "../context-policy/use-session-context-policy";

export interface PiModelSessionClient {
  reloadSession(localThreadId: string, remoteSessionId: string): Promise<void>;
}

export function usePiModelSessionClient(): PiModelSessionClient {
  const manager = usePiSessionManager();
  return useMemo(
    () => ({
      reloadSession: async (localThreadId: string, remoteSessionId: string) => {
        await manager.getSession(localThreadId, remoteSessionId).reload();
      },
    }),
    [manager],
  );
}
