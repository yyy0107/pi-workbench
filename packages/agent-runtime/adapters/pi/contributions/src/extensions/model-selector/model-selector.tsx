"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useCurrentSession } from "@workbench/agent-runtime-client";
import { ModelSelector as ModelSelectorControl } from "@workbench/shell/ui";
import { useI18n } from "@workbench/shell/i18n";
import { usePiI18n } from "../../i18n";
import {
  usePiConfigurationClient,
  usePiModelSessionClient,
  useSessionContextPolicy,
} from "@workbench/agent-runtime-pi-client/configuration";
import type {
  ModelCatalogValue,
  ModelSelection,
  SessionModelsValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import { useWorkspaceSelection } from "@workbench/agent-runtime-client/workspaces";

import {
  draftSelectorModels,
  modelChangeSelection,
  modelSelection,
  modelSelectorId,
  resolveDraftSelectorModel,
  sessionSelectorModels,
} from "../../model-selector/model-selector-state";
import { useHydrateModelSelectorStore, useModelSelectorStore } from "./model-selector-store";
import { reasoningEffortLabel } from "../../model-selector/reasoning-effort-label";

type LoadedCatalog =
  | { scopeKey: string; kind: "session"; value: SessionModelsValue }
  | { scopeKey: string; kind: "draft"; value: ModelCatalogValue };

interface OptimisticSelection {
  scopeKey: string;
  value: ModelSelection;
}

export function ModelSelector() {
  useHydrateModelSelectorStore();
  const { t } = usePiI18n();
  const { t: tShell } = useI18n();
  const configurationClient = usePiConfigurationClient();
  const sessionClient = usePiModelSessionClient();
  const current = useCurrentSession();
  const localThreadId = current.sessionId ?? "unbound";
  const remoteId = current.threadId;
  const contextPolicy = useSessionContextPolicy(remoteId);
  const draftModelId = useModelSelectorStore(
    (state) => state.draftSelections[localThreadId]?.modelId,
  );
  const draftReasoningEffort = useModelSelectorStore(
    (state) =>
      state.draftSelections[localThreadId]?.reasoningEffort ??
      state.rememberedSelection?.reasoningEffort ??
      "medium",
  );
  const rememberedModelId = useModelSelectorStore((state) => state.rememberedSelection?.modelId);
  const setDraftSelection = useModelSelectorStore((state) => state.setDraftSelection);
  const clearDraftSelection = useModelSelectorStore((state) => state.clearDraftSelection);
  const rememberSelection = useModelSelectorStore((state) => state.rememberSelection);
  const { draftWorkspace } = useWorkspaceSelection();
  const [loadedCatalog, setLoadedCatalog] = useState<LoadedCatalog>();
  const [failedScope, setFailedScope] = useState<string>();
  const [optimisticSelection, setOptimisticSelection] = useState<OptimisticSelection>();
  const [selectionFailedScope, setSelectionFailedScope] = useState<string>();
  const scopeKey = remoteId
    ? `session:${remoteId}`
    : `draft:${localThreadId}:${draftWorkspace?.id ?? "none"}`;
  const currentScopeRef = useRef(scopeKey);
  const catalogRequestRef = useRef(0);
  currentScopeRef.current = scopeKey;
  const catalogRevision = useSyncExternalStore(
    configurationClient.subscribeModelCatalog,
    configurationClient.getModelCatalogRevision,
    configurationClient.getModelCatalogRevision,
  );
  const subscribeSessionSelection = useCallback(
    (listener: () => void) =>
      remoteId
        ? configurationClient.subscribeSessionModelSelection(remoteId, listener)
        : () => undefined,
    [configurationClient, remoteId],
  );
  const getSessionSelectionRevision = useCallback(
    () => (remoteId ? configurationClient.getSessionModelSelectionRevision(remoteId) : 0),
    [configurationClient, remoteId],
  );
  const sessionSelectionRevision = useSyncExternalStore(
    subscribeSessionSelection,
    getSessionSelectionRevision,
    () => 0,
  );

  const catalog = loadedCatalog?.scopeKey === scopeKey ? loadedCatalog : undefined;
  const loadFailed = failedScope === scopeKey;
  const selectionFailed = selectionFailedScope === scopeKey;
  const savingSelection = optimisticSelection?.scopeKey === scopeKey;

  useEffect(() => {
    setOptimisticSelection(undefined);
    setSelectionFailedScope(undefined);
  }, [scopeKey]);

  const loadCatalog = useCallback(() => {
    const request = ++catalogRequestRef.current;
    setFailedScope(undefined);

    const complete = (next: LoadedCatalog) => {
      if (request !== catalogRequestRef.current || currentScopeRef.current !== scopeKey) return;
      setLoadedCatalog(next);
      setFailedScope(undefined);
    };
    const fail = () => {
      if (request !== catalogRequestRef.current || currentScopeRef.current !== scopeKey) return;
      setFailedScope(scopeKey);
    };

    if (remoteId) {
      void configurationClient
        .listSessionModels({ sessionId: remoteId })
        .then((value) => complete({ scopeKey, kind: "session", value }), fail);
    } else {
      void configurationClient
        .listModelCatalog()
        .then((value) => complete({ scopeKey, kind: "draft", value }), fail);
    }
  }, [configurationClient, remoteId, scopeKey]);

  useEffect(() => {
    loadCatalog();
    return () => {
      catalogRequestRef.current += 1;
    };
  }, [catalogRevision, loadCatalog, sessionSelectionRevision]);

  useEffect(() => {
    if (remoteId) clearDraftSelection(localThreadId);
  }, [clearDraftSelection, localThreadId, remoteId]);

  const selectorModels = useMemo(() => {
    if (!catalog) return [];
    if (catalog.kind === "session") return sessionSelectorModels(catalog.value);
    return draftSelectorModels(catalog.value);
  }, [catalog]);

  const models = selectorModels;

  const selectedDraftModel = useMemo(() => {
    if (remoteId || catalog?.kind !== "draft") return undefined;
    return resolveDraftSelectorModel(selectorModels, draftModelId, rememberedModelId);
  }, [catalog, draftModelId, rememberedModelId, remoteId, selectorModels]);

  useEffect(() => {
    if (!selectedDraftModel || draftModelId === selectedDraftModel.id) return;
    const nextSelection = modelSelection(selectedDraftModel, draftReasoningEffort);
    setDraftSelection(localThreadId, {
      modelId: selectedDraftModel.id,
      ...(nextSelection.reasoningEffort ? { reasoningEffort: nextSelection.reasoningEffort } : {}),
    });
  }, [draftModelId, draftReasoningEffort, localThreadId, selectedDraftModel, setDraftSelection]);

  const currentSessionSelection =
    optimisticSelection?.scopeKey === scopeKey
      ? optimisticSelection.value
      : catalog?.kind === "session"
        ? catalog.value.current
        : undefined;
  const selectedModelId = currentSessionSelection
    ? modelSelectorId(currentSessionSelection.provider, currentSessionSelection.model)
    : selectedDraftModel?.id;
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];
  const selectedEffort = selectedModel?.efforts
    ? modelSelection(
        selectedModel,
        currentSessionSelection?.reasoningEffort ?? draftReasoningEffort,
      ).reasoningEffort
    : undefined;

  useEffect(() => {
    sessionClient.setDraftSelection(
      localThreadId,
      remoteId || !selectedModel
        ? undefined
        : {
            provider: selectedModel.provider,
            model: selectedModel.model,
            ...(selectedEffort ? { reasoningEffort: selectedEffort } : {}),
          },
    );
  }, [localThreadId, remoteId, selectedEffort, selectedModel, sessionClient]);

  const applySessionSelection = useCallback(
    (selection: ModelSelection) => {
      if (!remoteId) return;
      const requestScope = scopeKey;
      setSelectionFailedScope(undefined);
      setOptimisticSelection({ scopeKey: requestScope, value: selection });
      void configurationClient
        .selectSessionModel({
          sessionId: remoteId,
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
        })
        .then(
          ({ selected }) => {
            rememberSelection({
              modelId: modelSelectorId(selected.provider, selected.model),
              ...(selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort } : {}),
            });
            if (currentScopeRef.current !== requestScope) return;
            setLoadedCatalog((current) =>
              current?.scopeKey === requestScope && current.kind === "session"
                ? {
                    ...current,
                    value: { ...current.value, current: selected, routable: true },
                  }
                : current,
            );
            setOptimisticSelection((current) =>
              current?.scopeKey === requestScope ? undefined : current,
            );
            void sessionClient
              .reloadSession(localThreadId, remoteId)
              .catch((error) =>
                console.error("[workbench-pi] model change timeline refresh failed", error),
              );
            void contextPolicy.refresh();
          },
          () => {
            if (currentScopeRef.current !== requestScope) return;
            setOptimisticSelection((current) =>
              current?.scopeKey === requestScope ? undefined : current,
            );
            setSelectionFailedScope(requestScope);
          },
        );
    },
    [
      configurationClient,
      contextPolicy,
      localThreadId,
      rememberSelection,
      remoteId,
      scopeKey,
      sessionClient,
    ],
  );

  const changeModel = useCallback(
    (modelId: string) => {
      const nextModel = selectorModels.find((model) => model.id === modelId);
      if (!nextModel || nextModel.unavailable) return;
      const nextSelection = modelChangeSelection(nextModel);
      if (remoteId) {
        applySessionSelection(nextSelection);
      } else {
        const selection = {
          modelId: nextModel.id,
          reasoningEffort: nextSelection.reasoningEffort ?? draftReasoningEffort,
        };
        setDraftSelection(localThreadId, selection);
        rememberSelection(selection);
      }
    },
    [
      applySessionSelection,
      draftReasoningEffort,
      localThreadId,
      remoteId,
      rememberSelection,
      selectorModels,
      setDraftSelection,
    ],
  );

  const changeEffort = useCallback(
    (effort: string) => {
      if (!selectedModel?.efforts?.some((candidate) => candidate.id === effort)) return;
      const nextSelection = modelSelection(selectedModel, effort);
      if (remoteId) {
        applySessionSelection(nextSelection);
      } else {
        const selection = {
          modelId: selectedModel.id,
          reasoningEffort: effort,
        };
        setDraftSelection(localThreadId, selection);
        rememberSelection(selection);
      }
    },
    [
      applySessionSelection,
      localThreadId,
      rememberSelection,
      remoteId,
      selectedModel,
      setDraftSelection,
    ],
  );

  const currentUnavailable = catalog?.kind === "session" && !catalog.value.routable;
  const selectionLocked = savingSelection || contextPolicy.status === "saving";

  return (
    <ModelSelectorControl
      compact
      currentUnavailable={currentUnavailable}
      labels={{
        select: tShell("assistant.model.select"),
        model: tShell("assistant.model.model"),
        reasoningEffort: tShell("assistant.model.reasoningEffort"),
        search: t("extensions.modelSelector.searchLabel"),
        searchPlaceholder: t("extensions.modelSelector.searchPlaceholder"),
        loadFailed: t("extensions.modelSelector.loadFailed"),
        noModels: t("extensions.modelSelector.noModels"),
        noSearchResults: t("extensions.modelSelector.noSearchResults"),
        selectFailed: t("extensions.modelSelector.selectFailed"),
        currentUnavailable: t("extensions.modelSelector.currentUnavailable"),
        saving: t("extensions.modelSelector.saving"),
      }}
      loadFailed={loadFailed}
      models={models}
      selectedEffort={selectedEffort}
      selectedModelId={selectedModel?.id}
      selectionFailed={selectionFailed}
      selectionLocked={selectionLocked}
      getEffortLabel={(effort) => reasoningEffortLabel(effort, t)}
      onEffortChange={changeEffort}
      onModelChange={changeModel}
      onOpen={loadCatalog}
    />
  );
}
