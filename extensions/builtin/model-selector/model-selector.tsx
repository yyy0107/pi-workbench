"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { ModelSelector as ModelSelectorControl } from "@/components/ui/model-selector";
import { useI18n } from "@/i18n";
import {
  listPiModelCatalog,
  listPiRpcSessionModels,
  selectPiRpcSessionModel,
} from "@/runtime/pi/client/transport/api";
import {
  getPiModelCatalogRevision,
  getPiSessionModelSelectionRevision,
  subscribePiModelCatalogInvalidation,
  subscribePiSessionModelSelectionInvalidation,
} from "@/runtime/pi/client/models/model-catalog-invalidation";
import type {
  ModelCatalogValue,
  ModelSelection,
  SessionModelsValue,
} from "@/runtime/pi/contracts/rpc";
import { usePiSessionManager } from "@/runtime/pi/client/runtime/context";
import { useSessionContextPolicy } from "@/runtime/pi/client/context-policy/use-session-context-policy";
import { useWorkspaceSelection } from "@/services/workspace-selection-service";

import {
  draftSelectorModels,
  modelChangeSelection,
  modelSelection,
  modelSelectorId,
  resolveDraftSelectorModel,
  sessionSelectorModels,
  type SelectorModel,
} from "@/extensions/shared/model-selector/model-selector-state";
import { useModelSelectorStore } from "./model-selector-store";
import { reasoningEffortLabel } from "@/extensions/shared/model-selector/reasoning-effort-label";

type AppModel = SelectorModel;

type LoadedCatalog =
  | { scopeKey: string; kind: "session"; value: SessionModelsValue }
  | { scopeKey: string; kind: "draft"; value: ModelCatalogValue };

interface OptimisticSelection {
  scopeKey: string;
  value: ModelSelection;
}

function ModelContextBridge({
  model,
  reasoningEffort,
  includePiMetadata,
}: {
  model: AppModel;
  reasoningEffort?: string;
  includePiMetadata: boolean;
}) {
  const api = useAui();

  useEffect(
    () =>
      api.modelContext.register({
        getModelContext: () => ({
          config: {
            modelName: model.id,
            ...(reasoningEffort ? { reasoningEffort } : {}),
          },
          ...(includePiMetadata
            ? {
                unstable_composerMetadata: {
                  piModel: {
                    provider: model.provider,
                    modelId: model.model,
                    ...(model.efforts && reasoningEffort ? { thinkingLevel: reasoningEffort } : {}),
                  },
                },
              }
            : {}),
        }),
      }),
    [api, includePiMetadata, model.efforts, model.id, model.model, model.provider, reasoningEffort],
  );

  return null;
}

export function ModelSelector() {
  const { t } = useI18n();
  const sessionManager = usePiSessionManager();
  const localThreadId = useAuiState((state) => state.threadListItem.id);
  const remoteId = useAuiState((state) => state.threadListItem.remoteId);
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
    subscribePiModelCatalogInvalidation,
    getPiModelCatalogRevision,
    getPiModelCatalogRevision,
  );
  const subscribeSessionSelection = useCallback(
    (listener: () => void) =>
      remoteId ? subscribePiSessionModelSelectionInvalidation(remoteId, listener) : () => undefined,
    [remoteId],
  );
  const getSessionSelectionRevision = useCallback(
    () => (remoteId ? getPiSessionModelSelectionRevision(remoteId) : 0),
    [remoteId],
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
      void listPiRpcSessionModels({ sessionId: remoteId }).then(
        (value) => complete({ scopeKey, kind: "session", value }),
        fail,
      );
    } else {
      void listPiModelCatalog().then((value) => complete({ scopeKey, kind: "draft", value }), fail);
    }
  }, [remoteId, scopeKey]);

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

  const applySessionSelection = useCallback(
    (selection: ModelSelection) => {
      if (!remoteId) return;
      const requestScope = scopeKey;
      setSelectionFailedScope(undefined);
      setOptimisticSelection({ scopeKey: requestScope, value: selection });
      void selectPiRpcSessionModel({
        sessionId: remoteId,
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
      }).then(
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
          void sessionManager
            .getSession(localThreadId, remoteId)
            .reload()
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
    [contextPolicy, localThreadId, rememberSelection, remoteId, scopeKey, sessionManager],
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
    <>
      {selectedModel ? (
        <ModelContextBridge
          model={selectedModel}
          reasoningEffort={selectedEffort}
          includePiMetadata={!remoteId}
        />
      ) : null}
      <ModelSelectorControl
        currentUnavailable={currentUnavailable}
        labels={{
          select: t("assistant.model.select"),
          model: t("assistant.model.model"),
          reasoningEffort: t("assistant.model.reasoningEffort"),
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
    </>
  );
}
