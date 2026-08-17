"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAui } from "@assistant-ui/react";
import {
  ModelSelector as AssistantModelSelector,
  type ModelSelectorEffortOption,
  type ModelOption,
} from "@/components/assistant-ui/model-selector";
import {
  ReasoningEffort as ReasoningEffortControl,
  type EffortLevel,
} from "@/components/elements/reasoning-effort";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import type { ComposerSlotContext } from "@/platform/extensions";
import { listPiModels } from "@/runtime/pi/client/api";
import type { PiModelListResponse } from "@/runtime/pi/contracts";
import { useWorkspaceDirectoryStore } from "@/workbench/workspaces/workspace-directory-store";

import { type ReasoningEffort, useModelSelectorStore } from "./model-selector-store";
import { ProviderIcon } from "./provider-icon";

const ALL_PROVIDERS = "all";
const MODEL_BATCH_SIZE = 12;
const MODEL_SKELETON_COUNT = 3;

type AppModel = ModelOption & {
  provider: string;
  providerName: string;
  modelId: string;
  contextWindow: number;
};

const REASONING_EFFORTS = new Set<ReasoningEffort>(["low", "medium", "high"]);

function PiModelContextBridge({
  model,
  reasoningEffort,
}: {
  model: AppModel;
  reasoningEffort: ReasoningEffort;
}) {
  const api = useAui();

  useEffect(
    () =>
      api.modelContext.register({
        getModelContext: () => ({
          unstable_composerMetadata: {
            piModel: {
              provider: model.provider,
              modelId: model.modelId,
              ...(model.efforts ? { thinkingLevel: reasoningEffort } : {}),
            },
          },
        }),
      }),
    [api, model.efforts, model.id, model.provider, reasoningEffort],
  );

  return null;
}

function ModelListSkeleton({
  count,
  label,
  onVisible,
}: {
  count: number;
  label: string;
  onVisible(): void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = rootRef.current;
    const scrollRoot = element?.closest('[data-slot="model-selector-list"]');
    if (!element || !scrollRoot) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        onVisible();
      },
      { root: scrollRoot, rootMargin: "80px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [onVisible]);

  return (
    <div ref={rootRef} role="status" aria-label={label} className="px-1.5 pb-1">
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} aria-hidden="true" className="flex h-13 items-center gap-2 px-3">
          <Skeleton className="size-4.5 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ModelSelector({ isRunning }: ComposerSlotContext) {
  const { number, t } = useI18n();
  const modelId = useModelSelectorStore((state) => state.modelId);
  const reasoningEffort = useModelSelectorStore((state) => state.reasoningEffort);
  const setModelId = useModelSelectorStore((state) => state.setModelId);
  const setReasoningEffort = useModelSelectorStore((state) => state.setReasoningEffort);
  const activeWorkspace = useWorkspaceDirectoryStore((state) =>
    state.directories.find((directory) => directory.id === state.activeDirectoryId),
  );
  const [provider, setProvider] = useState(ALL_PROVIDERS);
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleModelCount, setVisibleModelCount] = useState(MODEL_BATCH_SIZE);
  const [catalog, setCatalog] = useState<PiModelListResponse>();
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setCatalog(undefined);
    setLoadFailed(false);
    setProvider(ALL_PROVIDERS);
    setSearchQuery("");
    if (!activeWorkspace)
      return () => {
        active = false;
      };
    void listPiModels(activeWorkspace.cwd).then(
      (response) => {
        if (!active) return;
        setCatalog(response);
        setLoadFailed(false);
      },
      () => {
        if (!active) return;
        setLoadFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [activeWorkspace?.cwd]);

  const reasoningLevels = useMemo(
    () =>
      [
        { key: "low", label: t("extensions.modelSelector.low") },
        { key: "medium", label: t("extensions.modelSelector.medium") },
        { key: "high", label: t("extensions.modelSelector.high") },
      ] satisfies readonly EffortLevel[],
    [t],
  );

  const models = useMemo(() => {
    const effortOptions = reasoningLevels.map(({ key, label }) => ({
      id: key,
      name: label,
    })) satisfies readonly ModelSelectorEffortOption[];

    return (catalog?.models ?? []).map((option): AppModel => ({
      id: `${option.provider}/${option.id}`,
      modelId: option.id,
      name: option.name,
      description: t("extensions.modelSelector.contextWindow", {
        count: option.contextWindow,
      }),
      icon: <ProviderIcon provider={option.provider} modelName={option.name} />,
      provider: option.provider,
      providerName: option.providerName,
      contextWindow: option.contextWindow,
      keywords: [option.provider, option.providerName],
      efforts: option.reasoning ? effortOptions : undefined,
    }));
  }, [catalog?.models, reasoningLevels, t]);

  useEffect(() => {
    if (!models.length) return;
    if (modelId && models.some((model) => model.id === modelId)) return;
    const preferred = catalog?.defaultModel
      ? models.find(
          (model) =>
            model.provider === catalog.defaultModel?.provider &&
            model.modelId === catalog.defaultModel.modelId,
        )
      : undefined;
    setModelId((preferred ?? models[0]).id);
  }, [catalog?.defaultModel, modelId, models, setModelId]);

  const filteredModels = useMemo(() => {
    if (provider === ALL_PROVIDERS) return models;
    return models.filter((model) => model.provider === provider);
  }, [models, provider]);
  const isSearching = searchQuery.trim().length > 0;
  const visibleModels = isSearching ? filteredModels : filteredModels.slice(0, visibleModelCount);
  const remainingModelCount = filteredModels.length - visibleModels.length;
  const hasMoreModels = !isSearching && remainingModelCount > 0;

  useEffect(() => {
    setVisibleModelCount(MODEL_BATCH_SIZE);
  }, [models, provider, searchQuery]);

  const loadMoreModels = useCallback(() => {
    setVisibleModelCount((count) => Math.min(count + MODEL_BATCH_SIZE, filteredModels.length));
  }, [filteredModels.length]);

  const providers = useMemo(
    () =>
      Array.from(new Map(models.map((model) => [model.provider, model.providerName])).entries()),
    [models],
  );
  const selectedModel = models.find((model) => model.id === modelId) ?? models[0];

  return (
    <fieldset
      className="min-w-0 disabled:pointer-events-none disabled:opacity-50"
      disabled={isRunning || (!catalog && !loadFailed)}
      title={isRunning ? t("extensions.modelSelector.locked") : undefined}
    >
      <AssistantModelSelector.Root
        models={models}
        value={selectedModel?.id}
        effort={reasoningEffort}
        defaultEffort="medium"
        onValueChange={(value) => {
          if (models.some((model) => model.id === value)) setModelId(value);
        }}
        onEffortChange={(effort) => {
          if (REASONING_EFFORTS.has(effort as ReasoningEffort)) {
            setReasoningEffort(effort as ReasoningEffort);
          }
        }}
      >
        {selectedModel && (
          <PiModelContextBridge model={selectedModel} reasoningEffort={reasoningEffort} />
        )}
        <AssistantModelSelector.Trigger
          variant="ghost"
          size="sm"
          className="h-auto max-w-48 gap-1 border-0 bg-transparent px-1.5 py-1 text-sm shadow-none hover:bg-muted [&>svg]:opacity-0 [&>svg]:transition-[opacity,transform] hover:[&>svg]:opacity-50 data-popup-open:[&>svg]:rotate-180"
        >
          <AssistantModelSelector.Value showIcon={false} showEffort={false} />
        </AssistantModelSelector.Trigger>

        <AssistantModelSelector.Content
          className="w-80 max-w-[calc(100vw-1rem)] [&_[data-slot=command]]:p-0 [&_[data-slot=command-input-wrapper]]:border-b [&_[data-slot=command-input-wrapper]]:p-0 [&_[data-slot=input-group]]:h-10! [&_[data-slot=input-group]]:rounded-none! [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:px-2 [&_[data-slot=model-selector-list]]:max-h-56"
          align="end"
        >
          <AssistantModelSelector.Search value={searchQuery} onValueChange={setSearchQuery} />

          <div
            className="flex flex-wrap gap-1 border-b px-3 py-2"
            onKeyDown={(event) => event.stopPropagation()}
          >
            {providers.map(([item, label]) => {
              const active = provider === item;

              return (
                <button
                  key={item}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setProvider(active ? ALL_PROVIDERS : item)}
                  className={[
                    "rounded-full border px-2 py-0.5 text-xs leading-4 transition-colors",
                    active
                      ? "border-foreground/20 bg-muted text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                  ].join(" ")}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <AssistantModelSelector.List className="[scrollbar-width:thin] [&::-webkit-scrollbar]:block [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
            <AssistantModelSelector.Empty>
              {loadFailed
                ? t("extensions.modelSelector.loadFailed")
                : t("extensions.modelSelector.noModels")}
            </AssistantModelSelector.Empty>

            {providers.map(([providerId, providerName]) => {
              const providerModels = visibleModels.filter((model) => model.provider === providerId);
              if (!providerModels.length) return null;
              return (
                <AssistantModelSelector.Group
                  key={providerId}
                  heading={providerName}
                  className="px-1 py-1 **:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:py-1 **:[[cmdk-group-heading]]:text-xs"
                >
                  {providerModels.map((model) => (
                    <AssistantModelSelector.Item
                      key={model.id}
                      model={model}
                      className="min-h-13 rounded-lg py-1.5 ps-3 pe-10"
                    />
                  ))}
                </AssistantModelSelector.Group>
              );
            })}

            {hasMoreModels && (
              <ModelListSkeleton
                key={visibleModelCount}
                count={Math.min(MODEL_SKELETON_COUNT, remainingModelCount)}
                label={t("extensions.modelSelector.loadingMore")}
                onVisible={loadMoreModels}
              />
            )}
          </AssistantModelSelector.List>

          {selectedModel?.efforts && (
            <div className="border-t p-2.5" onKeyDown={(event) => event.stopPropagation()}>
              <ReasoningEffortControl
                className="max-w-none gap-2"
                levels={reasoningLevels}
                selectedKey={reasoningEffort}
                label={t("extensions.modelSelector.thinking")}
                formatNumber={number}
                onSelect={(effort) => {
                  if (REASONING_EFFORTS.has(effort as ReasoningEffort)) {
                    setReasoningEffort(effort as ReasoningEffort);
                  }
                }}
              />
            </div>
          )}
        </AssistantModelSelector.Content>
      </AssistantModelSelector.Root>
    </fieldset>
  );
}
