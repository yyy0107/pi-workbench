"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { ChevronDownIcon, SearchIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import type { ComposerSlotContext } from "@/platform/extensions";
import {
  listPiModelCatalog,
  listPiRpcSessionModels,
  selectPiRpcSessionModel,
} from "@/runtime/pi/client/transport/api";
import {
  getPiModelCatalogRevision,
  subscribePiModelCatalogInvalidation,
} from "@/runtime/pi/client/models/model-catalog-invalidation";
import type {
  ModelCatalogValue,
  ModelSelection,
  SessionModelsValue,
} from "@/runtime/pi/rpc-contracts";
import { usePiSessionManager } from "@/runtime/pi/client/runtime/context";
import { useWorkspaceDirectoryStore } from "@/workbench/workspaces/workspace-directory-store";

import {
  draftSelectorModels,
  filterSelectorModels,
  modelChangeSelection,
  modelSelection,
  modelSelectorId,
  resolveDraftSelectorModel,
  sessionSelectorModels,
  type SelectorModel,
} from "./model-selector-state";
import { useModelSelectorStore } from "./model-selector-store";

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

function MenuStatus({ children, alert }: { children: React.ReactNode; alert?: boolean }) {
  return (
    <div
      role={alert ? "alert" : "status"}
      className="text-muted-foreground border-b px-2 py-2 text-xs leading-4"
    >
      {children}
    </div>
  );
}

function ModelMenuItem({ model, disabled }: { model: AppModel; disabled: boolean }) {
  return (
    <DropdownMenuRadioItem
      value={model.id}
      disabled={disabled || model.unavailable}
      className="mx-1 h-8 gap-2 px-2 pe-8"
    >
      <span className="min-w-0 flex-1 truncate" title={model.name}>
        {model.name}
      </span>
    </DropdownMenuRadioItem>
  );
}

function ModelMenuGroup({
  providerName,
  models,
  disabled,
}: {
  providerName: string;
  models: readonly AppModel[];
  disabled: boolean;
}) {
  return (
    <div>
      <DropdownMenuLabel className="bg-popover sticky top-10 z-10 px-2 py-1">
        {providerName}
      </DropdownMenuLabel>
      {models.map((model) => (
        <ModelMenuItem key={model.id} model={model} disabled={disabled} />
      ))}
    </div>
  );
}

function ModelSearch({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
}) {
  return (
    <div className="bg-popover sticky top-0 z-20 flex h-10 items-center px-1">
      <div className="relative w-full">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2" />
        <Input
          type="search"
          value={value}
          aria-label={label}
          placeholder={placeholder}
          className="bg-background h-8 rounded-md ps-8 shadow-none"
          onChange={(event) => {
            const nextValue = event.currentTarget.value;
            onChange(nextValue);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") event.stopPropagation();
          }}
        />
      </div>
    </div>
  );
}

function MenuCurrentValue({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground ms-auto max-w-32 truncate">{children}</span>;
}

export function ModelSelector({ isRunning }: ComposerSlotContext) {
  const { t } = useI18n();
  const sessionManager = usePiSessionManager();
  const localThreadId = useAuiState((state) => state.threadListItem.id);
  const remoteId = useAuiState((state) => state.threadListItem.remoteId);
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
  const draftWorkspace = useWorkspaceDirectoryStore((state) =>
    state.directories.find((directory) => directory.id === state.draftDirectoryId),
  );
  const [modelQuery, setModelQuery] = useState("");
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
    } else if (draftWorkspace) {
      void listPiModelCatalog().then((value) => complete({ scopeKey, kind: "draft", value }), fail);
    }
  }, [draftWorkspace, remoteId, scopeKey]);

  useEffect(() => {
    loadCatalog();
    return () => {
      catalogRequestRef.current += 1;
    };
  }, [catalogRevision, loadCatalog]);

  useEffect(() => {
    if (remoteId) clearDraftSelection(localThreadId);
  }, [clearDraftSelection, localThreadId, remoteId]);

  const selectorModels = useMemo(() => {
    if (!catalog) return [];
    if (catalog.kind === "session") return sessionSelectorModels(catalog.value);
    return draftSelectorModels(catalog.value);
  }, [catalog]);

  const models = selectorModels;
  const filteredModels = useMemo(
    () => filterSelectorModels(models, modelQuery),
    [modelQuery, models],
  );

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
  const reasoningLevels = selectedModel?.efforts ?? [];
  const selectedEffortLabel = reasoningLevels.find((level) => level.id === selectedEffort)?.name;

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
    [localThreadId, rememberSelection, remoteId, scopeKey, sessionManager],
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

  const providers = useMemo(
    () =>
      Array.from(
        new Map(filteredModels.map((model) => [model.provider, model.providerName])).entries(),
      ),
    [filteredModels],
  );
  const currentUnavailable = catalog?.kind === "session" && !catalog.value.routable;
  const loading = !catalog && !loadFailed;
  const selectionLocked = isRunning || savingSelection || loading;

  return (
    <fieldset
      className="min-w-0 shrink-0 disabled:pointer-events-none disabled:opacity-50"
      disabled={selectionLocked}
      title={
        isRunning
          ? t("extensions.modelSelector.locked")
          : savingSelection
            ? t("extensions.modelSelector.saving")
            : undefined
      }
    >
      {selectedModel && (
        <ModelContextBridge
          model={selectedModel}
          reasoningEffort={selectedEffort}
          includePiMetadata={!remoteId}
        />
      )}
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) loadCatalog();
          else setModelQuery("");
        }}
      >
        <DropdownMenuTrigger
          disabled={selectionLocked}
          aria-label={t("assistant.model.select")}
          className="group hover:bg-muted data-popup-open:bg-muted data-popup-open:w-72 relative flex h-[34px] w-48 max-w-[calc(100vw-8rem)] items-center justify-center rounded-md bg-transparent px-2 py-0 text-base outline-none transition-[width,background-color,color] duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed"
        >
          <span
            className="group-hover:pe-6 group-hover:text-start group-focus-visible:pe-6 group-focus-visible:text-start group-data-popup-open:px-6 group-data-popup-open:text-center block w-full min-w-0 truncate text-center font-mono font-medium transition-[padding] duration-200 ease-out"
            title={selectedModel?.name}
          >
            {selectedModel?.name ?? t("assistant.model.select")}
          </span>
          <ChevronDownIcon className="absolute end-2 size-3.5 shrink-0 opacity-0 transition-[opacity,transform] group-hover:opacity-50 group-focus-visible:opacity-50 group-data-popup-open:rotate-180 group-data-popup-open:opacity-50" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" side="bottom" sideOffset={4} className="w-72 min-w-72">
          {(selectionFailed || currentUnavailable) && (
            <MenuStatus alert={selectionFailed}>
              {selectionFailed
                ? t("extensions.modelSelector.selectFailed")
                : t("extensions.modelSelector.currentUnavailable")}
            </MenuStatus>
          )}

          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              disabled={selectionLocked || !models.length}
              className="min-h-9 gap-3 px-2 py-1.5 [&>svg]:ml-1.5"
            >
              <span>{t("assistant.model.model")}</span>
              <MenuCurrentValue>
                {selectedModel?.name ?? t("assistant.model.select")}
              </MenuCurrentValue>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              className="max-h-80 w-72 overflow-y-auto p-0 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent"
              sideOffset={4}
            >
              {!loadFailed && models.length > 0 && (
                <ModelSearch
                  value={modelQuery}
                  onChange={setModelQuery}
                  label={t("extensions.modelSelector.searchLabel")}
                  placeholder={t("extensions.modelSelector.searchPlaceholder")}
                />
              )}
              {loadFailed || !models.length ? (
                <MenuStatus alert={loadFailed}>
                  {loadFailed
                    ? t("extensions.modelSelector.loadFailed")
                    : t("extensions.modelSelector.noModels")}
                </MenuStatus>
              ) : !filteredModels.length ? (
                <MenuStatus>{t("extensions.modelSelector.noSearchResults")}</MenuStatus>
              ) : (
                <DropdownMenuRadioGroup value={selectedModel?.id} onValueChange={changeModel}>
                  {providers.map(([providerId, providerName], index) => {
                    const providerModels = filteredModels.filter(
                      (model) => model.provider === providerId,
                    );
                    if (!providerModels.length) return null;
                    return (
                      <div key={providerId}>
                        {index > 0 && <DropdownMenuSeparator className="mx-0 my-0" />}
                        <ModelMenuGroup
                          providerName={providerName}
                          models={providerModels}
                          disabled={selectionLocked}
                        />
                      </div>
                    );
                  })}
                </DropdownMenuRadioGroup>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              disabled={selectionLocked || !reasoningLevels.length}
              className="min-h-9 gap-3 px-2 py-1.5 [&>svg]:ml-1.5"
            >
              <span>{t("assistant.model.reasoningEffort")}</span>
              <MenuCurrentValue>{selectedEffortLabel ?? "—"}</MenuCurrentValue>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44" sideOffset={4}>
              <DropdownMenuRadioGroup value={selectedEffort} onValueChange={changeEffort}>
                {reasoningLevels.map((level) => (
                  <DropdownMenuRadioItem
                    key={level.id}
                    value={level.id}
                    disabled={selectionLocked}
                    className="h-8 px-2 pe-8"
                  >
                    <span className="min-w-0 flex-1 truncate">{level.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </fieldset>
  );
}
