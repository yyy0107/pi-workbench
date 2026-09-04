"use client";

import { useMemo } from "react";

import { usePiSessionManager } from "../runtime/context";
import {
  cancelPiModelProviderLogin,
  configurePiModelProvider,
  describePiSettings,
  discoverPiModels,
  getPiModelProviderConfig,
  getPiModelProviderLogin,
  listPiModelProviders,
  openPiSettingsDocument,
  removePiModelProvider,
  respondPiModelProviderLogin,
  startPiModelProviderLogin,
  testPiModelImageInput,
  updatePiAgentSettings,
} from "../transport/api";

/** Bind configuration RPC to the current installation without exposing Host connection details. */
export function usePiConfigurationClient() {
  const manager = usePiSessionManager();
  return useMemo(() => {
    const options = manager.rpcTransportOptions;
    return {
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
      configureModelProvider: (payload: Parameters<typeof configurePiModelProvider>[0]) =>
        configurePiModelProvider(payload, options),
      removeModelProvider: (payload: Parameters<typeof removePiModelProvider>[0]) =>
        removePiModelProvider(payload, options),
      discoverModels: (payload: Parameters<typeof discoverPiModels>[0]) =>
        discoverPiModels(payload, options),
      testModelImageInput: (payload: Parameters<typeof testPiModelImageInput>[0]) =>
        testPiModelImageInput(payload, options),
      describeAgentSettings: () => describePiSettings(options),
      updateAgentSettings: (payload: Parameters<typeof updatePiAgentSettings>[0]) =>
        updatePiAgentSettings(payload, options),
      openAgentSettingsDocument: () => openPiSettingsDocument(options),
    };
  }, [manager]);
}
