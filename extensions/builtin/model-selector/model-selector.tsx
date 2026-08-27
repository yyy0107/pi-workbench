"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { ChevronDownIcon, SearchIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  SelectorDropdownContent,
  useAnimatedSelectorDropdown,
} from "@/components/ui/selector-dropdown";
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
import { useSessionContextPolicy } from "@/runtime/pi/client/context-policy/use-session-context-policy";
import { useWorkspaceSelection } from "@/services/workspace-selection-service";

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
import { reasoningEffortLabel } from "./reasoning-effort-label";

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
      closeOnClick={false}
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
  providerId,
  providerName,
  providers,
  models,
  selectedModelId,
  disabled,
  groupRef,
  onModelChange,
  onProviderChange,
}: {
  providerId: string;
  providerName: string;
  providers: ReadonlyArray<readonly [string, string]>;
  models: readonly AppModel[];
  selectedModelId?: string;
  disabled: boolean;
  groupRef: (element: HTMLDivElement | null) => void;
  onModelChange: (modelId: string) => void;
  onProviderChange: (providerId: string) => void;
}) {
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);

  const changeProvider = (nextProviderId: string) => {
    setProviderMenuOpen(false);
    window.requestAnimationFrame(() => onProviderChange(nextProviderId));
  };

  return (
    <div ref={groupRef}>
      <DropdownMenuSub open={providerMenuOpen} onOpenChange={setProviderMenuOpen}>
        <DropdownMenuSubTrigger
          openOnHover={false}
          className="bg-popover sticky top-0 z-10 h-7 w-full cursor-pointer rounded-none px-2 py-0 text-xs font-medium text-muted-foreground focus:bg-accent data-popup-open:bg-accent [&>svg:last-child]:hidden"
        >
          <span className="min-w-0 flex-1 truncate text-start">{providerName}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-50" />
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          align="start"
          alignOffset={0}
          side="bottom"
          sideOffset={0}
          className="max-h-64 w-52 overflow-y-auto"
        >
          <DropdownMenuRadioGroup value={providerId} onValueChange={changeProvider}>
            {providers.map(([candidateId, candidateName]) => (
              <DropdownMenuRadioItem
                key={candidateId}
                value={candidateId}
                closeOnClick={false}
                className="h-8 px-2 pe-8"
              >
                <span className="min-w-0 flex-1 truncate" title={candidateName}>
                  {candidateName}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuRadioGroup value={selectedModelId} onValueChange={onModelChange}>
        {models.map((model) => (
          <ModelMenuItem key={model.id} model={model} disabled={disabled} />
        ))}
      </DropdownMenuRadioGroup>
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
    <div className="bg-popover flex h-10 items-center px-1">
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
  const [modelQuery, setModelQuery] = useState("");
  const [loadedCatalog, setLoadedCatalog] = useState<LoadedCatalog>();
  const [failedScope, setFailedScope] = useState<string>();
  const [optimisticSelection, setOptimisticSelection] = useState<OptimisticSelection>();
  const [selectionFailedScope, setSelectionFailedScope] = useState<string>();
  const selectorDropdown = useAnimatedSelectorDropdown();
  const scopeKey = remoteId
    ? `session:${remoteId}`
    : `draft:${localThreadId}:${draftWorkspace?.id ?? "none"}`;
  const currentScopeRef = useRef(scopeKey);
  const catalogRequestRef = useRef(0);
  const providerGroupRefs = useRef(new Map<string, HTMLDivElement>());
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
  const selectedEffortOption = reasoningLevels.find((level) => level.id === selectedEffort);
  const selectedEffortLabel = selectedEffortOption
    ? reasoningEffortLabel(selectedEffortOption, t)
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

  const providers = useMemo(
    () =>
      Array.from(
        new Map(filteredModels.map((model) => [model.provider, model.providerName])).entries(),
      ),
    [filteredModels],
  );
  const selectProviderGroup = useCallback((providerId: string) => {
    providerGroupRefs.current.get(providerId)?.scrollIntoView({ block: "start" });
  }, []);
  const currentUnavailable = catalog?.kind === "session" && !catalog.value.routable;
  const loading = !catalog && !loadFailed;
  const selectionLocked =
    isRunning || savingSelection || contextPolicy.status === "saving" || loading;

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
          selectorDropdown.onOpenChange(open);
          if (open) loadCatalog();
          else setModelQuery("");
        }}
      >
        <DropdownMenuTrigger
          ref={selectorDropdown.triggerRef}
          disabled={selectionLocked}
          aria-label={t("assistant.model.select")}
          style={selectorDropdown.triggerStyle}
          className="group hover:bg-muted data-popup-open:bg-muted relative flex h-[34px] w-fit max-w-32 items-center justify-center rounded-md bg-transparent px-2 py-0 text-base outline-none transition-[width,background-color,color] [transition-duration:400ms,200ms,200ms] ease-out focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed max-[360px]:max-w-24 sm:max-w-48"
          onTransitionEnd={selectorDropdown.onTriggerTransitionEnd}
        >
          <span
            className="group-hover:pe-6 group-focus-visible:pe-6 group-data-popup-open:pe-6 block max-w-full min-w-0 truncate text-end font-mono font-medium transition-[padding] duration-200 ease-out"
            title={selectedModel?.name}
          >
            {selectedModel?.name ?? t("assistant.model.select")}
          </span>
          <ChevronDownIcon className="absolute end-2 size-3.5 shrink-0 opacity-0 transition-[opacity,transform] group-hover:opacity-50 group-focus-visible:opacity-50 group-data-popup-open:rotate-180 group-data-popup-open:opacity-50" />
        </DropdownMenuTrigger>

        <SelectorDropdownContent
          align="end"
          side="bottom"
          sideOffset={4}
          style={selectorDropdown.contentStyle}
        >
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
              className="grid max-h-80 w-72 grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0"
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
              <div className="min-h-0 overflow-y-auto">
                {loadFailed || !models.length ? (
                  <MenuStatus alert={loadFailed}>
                    {loadFailed
                      ? t("extensions.modelSelector.loadFailed")
                      : t("extensions.modelSelector.noModels")}
                  </MenuStatus>
                ) : !filteredModels.length ? (
                  <MenuStatus>{t("extensions.modelSelector.noSearchResults")}</MenuStatus>
                ) : (
                  providers.map(([providerId, providerName], index) => {
                    const providerModels = filteredModels.filter(
                      (model) => model.provider === providerId,
                    );
                    if (!providerModels.length) return null;
                    return (
                      <div key={providerId}>
                        {index > 0 && <DropdownMenuSeparator className="mx-0 my-0" />}
                        <ModelMenuGroup
                          providerId={providerId}
                          providerName={providerName}
                          providers={providers}
                          models={providerModels}
                          selectedModelId={selectedModel?.id}
                          disabled={selectionLocked}
                          groupRef={(element) => {
                            if (element) providerGroupRefs.current.set(providerId, element);
                            else providerGroupRefs.current.delete(providerId);
                          }}
                          onModelChange={changeModel}
                          onProviderChange={selectProviderGroup}
                        />
                      </div>
                    );
                  })
                )}
              </div>
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
                    closeOnClick={false}
                    disabled={selectionLocked}
                    className="h-8 px-2 pe-8"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {reasoningEffortLabel(level, t)}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </SelectorDropdownContent>
      </DropdownMenu>
    </fieldset>
  );
}
