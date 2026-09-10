"use client";

import type { ModelSelection } from "@workbench/contracts/model-selection";
import type { ComposerSlotContext } from "@workbench/extension-sdk";
import { useMainViewService } from "@workbench/extension-host";
import { SettingsIcon } from "lucide-react";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useCurrentSession, useConversationSession } from "@workbench/agent-runtime-client";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  ModelSelector as ModelSelectorControl,
} from "@workbench/shell/ui";
import { createSettingsMainViewRequest } from "@workbench/shell/settings";
import { useI18n } from "@workbench/shell/i18n";
import {
  useWorkbenchModelSelectionCapability,
  useWorkbenchSessionContextPolicy,
} from "@workbench/agent-runtime-client/context";
import type { WorkbenchModelSelectionCapability } from "@workbench/agent-runtime-client/capabilities";
import type {
  WorkbenchModelCatalog,
  WorkbenchSessionModelCatalog,
} from "@workbench/agent-runtime-contracts/runtime-capabilities";
import { useWorkspaceSelection } from "@workbench/agent-runtime-client/workspaces";

import {
  draftSelectorModels,
  modelChangeSelection,
  modelSelection,
  modelSelectorId,
  resolveDraftSelectorModel,
  sessionSelectorModels,
} from "../../../model-selector/model-selector-state";
import { useHydrateModelSelectorStore, useModelSelectorStore } from "./model-selector-store";
import { reasoningEffortLabel } from "../../../model-selector/reasoning-effort-label";

type LoadedCatalog =
  | { scopeKey: string; kind: "session"; value: WorkbenchSessionModelCatalog }
  | { scopeKey: string; kind: "draft"; value: WorkbenchModelCatalog };

interface OptimisticSelection {
  scopeKey: string;
  value: ModelSelection;
}

function AvailableModelSelector({
  modelsCapability,
  submissionBlocked,
  registerSubmissionGuard,
}: {
  modelsCapability: WorkbenchModelSelectionCapability;
} & ComposerSlotContext) {
  useHydrateModelSelectorStore();
  const { t } = useI18n();
  const mainViews = useMainViewService();
  const current = useCurrentSession();
  const localThreadId = useConversationSession().id;
  const remoteId = current.sessionId === localThreadId ? current.threadId : localThreadId;
  const contextPolicy = useWorkbenchSessionContextPolicy(remoteId);
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
    modelsCapability.subscribeCatalog,
    modelsCapability.getCatalogRevision,
    modelsCapability.getCatalogRevision,
  );
  const subscribeSessionSelection = useCallback(
    (listener: () => void) =>
      remoteId ? modelsCapability.subscribeSessionSelection(remoteId, listener) : () => undefined,
    [modelsCapability, remoteId],
  );
  const getSessionSelectionRevision = useCallback(
    () => (remoteId ? modelsCapability.getSessionSelectionRevision(remoteId) : 0),
    [modelsCapability, remoteId],
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
      void modelsCapability
        .listSessionModels(remoteId)
        .then((value) => complete({ scopeKey, kind: "session", value }), fail);
    } else {
      void modelsCapability
        .listCatalog()
        .then((value) => complete({ scopeKey, kind: "draft", value }), fail);
    }
  }, [modelsCapability, remoteId, scopeKey]);

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
    modelsCapability.setDraftSelection(
      localThreadId,
      remoteId || !selectedModel
        ? undefined
        : {
            provider: selectedModel.provider,
            model: selectedModel.model,
            ...(selectedEffort ? { reasoningEffort: selectedEffort } : {}),
          },
    );
  }, [localThreadId, remoteId, selectedEffort, selectedModel, modelsCapability]);

  const applySessionSelection = useCallback(
    (selection: ModelSelection) => {
      if (!remoteId) return;
      const requestScope = scopeKey;
      setSelectionFailedScope(undefined);
      setOptimisticSelection({ scopeKey: requestScope, value: selection });
      void modelsCapability.selectSessionModel(remoteId, selection).then(
        (selected) => {
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
          void modelsCapability
            .reloadSession(localThreadId)
            .catch((error) =>
              console.error("[workbench] model change timeline refresh failed", error),
            );
          void contextPolicy.refresh().catch(() => undefined);
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
    [contextPolicy, localThreadId, rememberSelection, remoteId, scopeKey, modelsCapability],
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
  const modelReady =
    selectedModel !== undefined && !selectedModel.unavailable && !currentUnavailable;
  useEffect(
    () => registerSubmissionGuard?.(() => modelReady),
    [modelReady, registerSubmissionGuard],
  );

  return (
    <ModelSelectorControl
      compact
      validationError={
        submissionBlocked && !modelReady ? t("extensions.modelSelector.required") : undefined
      }
      currentUnavailable={currentUnavailable}
      labels={{
        select: t("assistant.model.select"),
        provider: t("extensions.modelSelector.provider"),
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
      footer={
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => mainViews.open(createSettingsMainViewRequest("model-config"))}
            className="h-[var(--dropdown-control-height)] gap-2 px-2"
          >
            <SettingsIcon aria-hidden="true" />
            {t("extensions.modelSelector.manageModels")}
          </DropdownMenuItem>
        </>
      }
    />
  );
}

export function ModelSelector(props: ComposerSlotContext) {
  const models = useWorkbenchModelSelectionCapability();
  return models ? <AvailableModelSelector {...props} modelsCapability={models} /> : null;
}
