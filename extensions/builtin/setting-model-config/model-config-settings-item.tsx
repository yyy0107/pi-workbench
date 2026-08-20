"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuRadioGroup } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  SettingsDropdownContent,
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
} from "@/components/ui/settings-control";
import { useI18n } from "@/i18n";
import type { SettingsItemComponentProps } from "@/platform/extensions";
import {
  configurePiModelProvider,
  discoverPiModels,
  getPiModelProviderConfig,
  listPiModelProviders,
  PiApiError,
  removePiModelProvider,
} from "@/runtime/pi/client/transport/api";
import type {
  ConfigurableProviderView,
  ModelProviderModelConfiguration,
  ModelProvidersValue,
} from "@/runtime/pi/rpc-contracts";

type LoadState = "loading" | "ready" | "failed";
type Editor =
  | { mode: "add-provider" }
  | { mode: "add-custom" }
  | { mode: "edit"; provider: string };

const MODEL_PROVIDER_APIS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9._-]*$/u;
type ModelProviderApi = (typeof MODEL_PROVIDER_APIS)[number];

interface ModelDraft {
  key: number;
  id: string;
  name: string;
  contextWindow: string;
  maxTokens: string;
  expanded: boolean;
}

interface ProviderDraft {
  provider: string;
  displayName: string;
  apiKey: string;
  baseURL: string;
  defaultBaseURL: string;
  api: ModelProviderApi;
  customOpen: boolean;
  modelsSource: "adapter" | "custom";
  models: ModelDraft[];
  availableModels: ModelProviderModelConfiguration[];
}

let nextModelKey = 1;

function visibleProviders(value?: ModelProvidersValue): ConfigurableProviderView[] {
  return (
    value?.providers.filter((provider) => provider.configured || provider.configurationDefined) ??
    []
  );
}

function formatCapacity(value?: number): string {
  if (!value) return "";
  if (value % 1_000_000 === 0) return `${value / 1_000_000}M`;
  if (value % 1_000 === 0) return `${value / 1_000}K`;
  return String(value);
}

function parseCapacity(value: string): number | undefined {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([km])?$/iu);
  if (!match) return undefined;
  const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2] ? 1_000 : 1;
  const result = Number(match[1]) * multiplier;
  return Number.isInteger(result) && result > 0 ? result : undefined;
}

function toModelDraft(model: ModelProviderModelConfiguration, expanded = false): ModelDraft {
  return {
    key: nextModelKey++,
    id: model.id,
    name: model.name ?? "",
    contextWindow: formatCapacity(model.contextWindow),
    maxTokens: formatCapacity(model.maxTokens),
    expanded,
  };
}

function emptyModel(): ModelDraft {
  return toModelDraft({ id: "" });
}

function emptyDraft(provider = ""): ProviderDraft {
  return {
    provider,
    displayName: "",
    apiKey: "",
    baseURL: "",
    defaultBaseURL: "",
    api: "openai-completions",
    customOpen: false,
    modelsSource: "adapter",
    models: [],
    availableModels: [],
  };
}

export function ModelConfigSettingsItem({ sectionId, itemId }: SettingsItemComponentProps) {
  const { t } = useI18n();
  const [value, setValue] = useState<ModelProvidersValue>();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [editor, setEditor] = useState<Editor>();
  const [draft, setDraft] = useState<ProviderDraft>(() => emptyDraft());
  const [configLoading, setConfigLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingProviderId, setRemovingProviderId] = useState<string>();
  const [error, setError] = useState<string>();
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelPickerLoading, setModelPickerLoading] = useState(false);
  const [modelPickerError, setModelPickerError] = useState<string>();
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(() => new Set());
  const configRequest = useRef(0);
  const modelCatalogRequest = useRef(0);

  const applyProviders = useCallback((next: ModelProvidersValue) => setValue(next), []);

  const load = useCallback(() => {
    setLoadState("loading");
    setError(undefined);
    void listPiModelProviders().then(
      (next) => {
        applyProviders(next);
        setLoadState("ready");
      },
      () => setLoadState("failed"),
    );
  }, [applyProviders]);

  useEffect(load, [load]);

  const providers = value?.providers ?? [];
  const configured = useMemo(() => visibleProviders(value), [value]);
  const addableProviders = useMemo(
    () =>
      providers.filter(
        (provider) =>
          provider.active &&
          provider.apiKeyConfigurable &&
          !configured.some(({ provider: id }) => id === provider.provider),
      ),
    [configured, providers],
  );
  const busy = saving || removingProviderId !== undefined;

  const closeEditor = useCallback(() => {
    configRequest.current += 1;
    modelCatalogRequest.current += 1;
    setEditor(undefined);
    setDraft(emptyDraft());
    setConfigLoading(false);
    setModelPickerOpen(false);
    setModelPickerLoading(false);
    setModelPickerError(undefined);
    setSelectedModelIds(new Set());
    setError(undefined);
  }, []);

  const loadProviderConfig = useCallback(
    async (provider: ConfigurableProviderView) => {
      const request = ++configRequest.current;
      setConfigLoading(true);
      setError(undefined);
      setDraft({
        ...emptyDraft(provider.provider),
        apiKey: "",
        displayName: provider.displayName,
      });
      try {
        const configuration = await getPiModelProviderConfig({ provider: provider.provider });
        if (request !== configRequest.current) return;
        setDraft({
          provider: provider.provider,
          displayName: configuration.displayName,
          apiKey: "",
          baseURL: configuration.baseURL ?? "",
          defaultBaseURL: configuration.defaultBaseURL ?? "",
          api: MODEL_PROVIDER_APIS.find((api) => api === configuration.api) ?? "openai-completions",
          customOpen: false,
          modelsSource: configuration.modelsSource,
          models:
            configuration.modelsSource === "custom"
              ? configuration.models.map((model) => toModelDraft(model))
              : [],
          availableModels: configuration.models,
        });
      } catch {
        if (request === configRequest.current) {
          setError(t("extensions.modelConfig.errors.loadDetailsFailed"));
        }
      } finally {
        if (request === configRequest.current) setConfigLoading(false);
      }
    },
    [t],
  );

  const editProvider = useCallback(
    (provider: ConfigurableProviderView) => {
      if (editor?.mode === "edit" && editor.provider === provider.provider) {
        closeEditor();
        return;
      }
      setEditor({ mode: "edit", provider: provider.provider });
      void loadProviderConfig(provider);
    },
    [closeEditor, editor, loadProviderConfig],
  );

  const addProvider = useCallback(() => {
    const first = addableProviders[0];
    setEditor({ mode: "add-provider" });
    setError(undefined);
    if (first) void loadProviderConfig(first);
    else setDraft(emptyDraft());
  }, [addableProviders, loadProviderConfig]);

  const addCustomProvider = useCallback(() => {
    configRequest.current += 1;
    setEditor({ mode: "add-custom" });
    setDraft({
      ...emptyDraft(),
      customOpen: false,
      modelsSource: "adapter",
      models: [],
      availableModels: [],
    });
    setConfigLoading(false);
    setError(undefined);
  }, []);

  const errorLabel = useCallback(
    (failure: unknown) => {
      if (failure instanceof PiApiError) {
        if (failure.code === "model-provider-api-key-unsupported") {
          return t("extensions.modelConfig.errors.unsupported");
        }
        if (failure.code === "model-provider-configuration-readonly") {
          return t("extensions.modelConfig.errors.readonly");
        }
      }
      return t("extensions.modelConfig.errors.saveFailed");
    },
    [t],
  );

  const save = useCallback(async () => {
    if (!editor || saving || configLoading) return;
    const providerId = draft.provider.trim();
    if (!providerId) {
      setError(t("extensions.modelConfig.errors.providerRequired"));
      return;
    }
    if (editor.mode === "add-custom" && providers.some(({ provider }) => provider === providerId)) {
      setError(t("extensions.modelConfig.errors.providerExists"));
      return;
    }

    const selectedProvider = providers.find(({ provider }) => provider === providerId);
    const customProviderMode =
      editor.mode === "add-custom" || (editor.mode === "edit" && selectedProvider?.removable);
    if (customProviderMode && !PROVIDER_ID_PATTERN.test(providerId)) {
      setError(t("extensions.modelConfig.errors.invalidProviderId"));
      return;
    }

    let configuration;
    if (customProviderMode || draft.customOpen) {
      const baseURL = draft.baseURL.trim() || draft.defaultBaseURL.trim();
      if (!baseURL) {
        setError(t("extensions.modelConfig.errors.apiAddressRequired"));
        return;
      }
      if (draft.modelsSource === "custom" && draft.models.length === 0) {
        setError(t("extensions.modelConfig.errors.modelRequired"));
        return;
      }
      const models: ModelProviderModelConfiguration[] = [];
      for (const model of draft.modelsSource === "custom" ? draft.models : []) {
        const id = model.id.trim();
        const contextWindow = model.contextWindow.trim()
          ? parseCapacity(model.contextWindow)
          : undefined;
        const maxTokens = model.maxTokens.trim() ? parseCapacity(model.maxTokens) : undefined;
        if (
          !id ||
          (model.contextWindow.trim() && !contextWindow) ||
          (model.maxTokens.trim() && !maxTokens)
        ) {
          setError(t("extensions.modelConfig.errors.invalidModel"));
          return;
        }
        models.push({
          id,
          ...(model.name.trim() ? { name: model.name.trim() } : {}),
          ...(contextWindow ? { contextWindow } : {}),
          ...(maxTokens ? { maxTokens } : {}),
        });
      }
      if (new Set(models.map(({ id }) => id)).size !== models.length) {
        setError(t("extensions.modelConfig.errors.duplicateModel"));
        return;
      }
      configuration = {
        ...(draft.displayName.trim() ? { displayName: draft.displayName.trim() } : {}),
        baseURL,
        api: draft.api,
        ...(draft.modelsSource === "custom" ? { models } : {}),
      };
    }

    const apiKey = draft.apiKey.trim();
    if (!configuration && !apiKey) {
      const existing = providers.find(({ provider }) => provider === providerId);
      if (!existing?.configured) {
        setError(t("extensions.modelConfig.errors.environmentMissing"));
        return;
      }
      closeEditor();
      return;
    }

    setSaving(true);
    setError(undefined);
    try {
      const next = await configurePiModelProvider({
        provider: providerId,
        ...(apiKey ? { apiKey } : {}),
        ...(configuration ? { configuration } : {}),
      });
      applyProviders(next);
      closeEditor();
    } catch (failure) {
      setError(errorLabel(failure));
    } finally {
      setSaving(false);
    }
  }, [applyProviders, closeEditor, configLoading, draft, editor, errorLabel, providers, saving, t]);

  const remove = useCallback(
    async (providerId: string) => {
      if (busy) return;
      setRemovingProviderId(providerId);
      setError(undefined);
      try {
        applyProviders(await removePiModelProvider({ provider: providerId }));
        if (editor?.mode === "edit" && editor.provider === providerId) closeEditor();
      } catch (failure) {
        setError(errorLabel(failure));
      } finally {
        setRemovingProviderId(undefined);
      }
    },
    [applyProviders, busy, closeEditor, editor, errorLabel],
  );

  const updateModel = useCallback((key: number, patch: Partial<ModelDraft>, markCustom = true) => {
    setDraft((current) => ({
      ...current,
      ...(markCustom ? { modelsSource: "custom" as const } : {}),
      models: current.models.map((model) => (model.key === key ? { ...model, ...patch } : model)),
    }));
  }, []);

  const openModelPicker = useCallback(async () => {
    const request = ++modelCatalogRequest.current;
    setModelPickerOpen(true);
    setModelPickerLoading(true);
    setModelPickerError(undefined);

    const selectedProvider = providers.find(({ provider }) => provider === draft.provider);
    const baseURL = draft.baseURL.trim() || draft.defaultBaseURL.trim();
    try {
      const result = await discoverPiModels({
        settingsNs:
          draft.modelsSource === "adapter" && selectedProvider?.settingsNs
            ? selectedProvider.settingsNs
            : `custom:${draft.provider || "provider"}`,
        ...(selectedProvider ? { provider: draft.provider } : {}),
        ...(baseURL ? { baseURL } : {}),
        api: draft.api,
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      });
      if (request !== modelCatalogRequest.current) return;
      setDraft((current) => ({ ...current, availableModels: result.models }));
      const customIds = new Set(draft.models.map(({ id }) => id.trim()).filter(Boolean));
      setSelectedModelIds(
        new Set(
          result.models
            .filter(({ id }) => draft.modelsSource === "adapter" || customIds.has(id))
            .map(({ id }) => id),
        ),
      );
    } catch {
      if (request !== modelCatalogRequest.current) return;
      if (draft.availableModels.length > 0) {
        setSelectedModelIds(
          new Set(
            draft.availableModels
              .filter(
                ({ id }) =>
                  draft.modelsSource === "adapter" || draft.models.some((model) => model.id === id),
              )
              .map(({ id }) => id),
          ),
        );
      } else {
        setModelPickerError(t("extensions.modelConfig.errors.fetchModelsFailed"));
      }
    } finally {
      if (request === modelCatalogRequest.current) setModelPickerLoading(false);
    }
  }, [draft, providers, t]);

  const addSelectedModels = useCallback(() => {
    const currentModels = new Map(
      draft.models.filter(({ id }) => id.trim()).map((model) => [model.id.trim(), model]),
    );
    setDraft((current) => ({
      ...current,
      modelsSource: "custom",
      models: current.availableModels
        .filter(({ id }) => selectedModelIds.has(id))
        .map((model) => currentModels.get(model.id) ?? toModelDraft(model)),
    }));
    setModelPickerOpen(false);
    setModelPickerError(undefined);
  }, [draft.models, selectedModelIds]);

  const providerEditor = (mode: Editor["mode"]) => {
    const selectedProvider = providers.find(({ provider }) => provider === draft.provider);
    const addMode = mode === "add-provider";
    const customProviderMode =
      mode === "add-custom" || (mode === "edit" && selectedProvider?.removable);
    return (
      <div className="bg-muted/60 rounded-xl p-3 sm:p-4">
        {addMode ? (
          <div className="space-y-1.5">
            <label className="text-muted-foreground block text-sm">
              {t("extensions.modelConfig.provider")}
            </label>
            <DropdownMenu>
              <SettingsDropdownTrigger
                disabled={busy || addableProviders.length === 0}
                aria-label={t("extensions.modelConfig.selectProvider")}
              >
                <span className="min-w-0 truncate text-start">
                  {selectedProvider?.displayName ?? t("extensions.modelConfig.selectProvider")}
                </span>
                <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0" />
              </SettingsDropdownTrigger>
              <SettingsDropdownContent align="start" side="bottom" className="max-h-72">
                <DropdownMenuRadioGroup
                  value={draft.provider}
                  onValueChange={(providerId) => {
                    const provider = providers.find(({ provider }) => provider === providerId);
                    if (provider) void loadProviderConfig(provider);
                  }}
                >
                  {addableProviders.map((provider) => (
                    <SettingsDropdownRadioItem key={provider.provider} value={provider.provider}>
                      <span className="min-w-0 flex-1 truncate">{provider.displayName}</span>
                    </SettingsDropdownRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </SettingsDropdownContent>
            </DropdownMenu>
          </div>
        ) : null}

        {customProviderMode ? (
          <div className="space-y-3">
            <h3 className="text-base font-medium">
              {t("extensions.modelConfig.customProviderTitle")}
            </h3>
            <div className="space-y-1.5">
              <label htmlFor="custom-provider-id" className="text-muted-foreground block text-sm">
                {t("extensions.modelConfig.providerId")}
              </label>
              <Input
                id="custom-provider-id"
                value={draft.provider}
                disabled={busy || mode === "edit"}
                placeholder={t("extensions.modelConfig.providerIdPlaceholder")}
                className="bg-background h-10"
                onChange={(event) => {
                  const provider = event.currentTarget.value;
                  setDraft((current) => ({ ...current, provider }));
                }}
              />
              <p className="text-muted-foreground text-xs leading-5">
                {t("extensions.modelConfig.providerIdDescription")}
              </p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="custom-provider-name" className="text-muted-foreground block text-sm">
                {t("extensions.modelConfig.providerName")}
              </label>
              <Input
                id="custom-provider-name"
                value={draft.displayName}
                disabled={busy}
                placeholder={t("extensions.modelConfig.providerNamePlaceholder")}
                className="bg-background h-10"
                onChange={(event) => {
                  const displayName = event.currentTarget.value;
                  setDraft((current) => ({ ...current, displayName }));
                }}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="custom-provider-base-url"
                className="text-muted-foreground block text-sm"
              >
                {t("extensions.modelConfig.apiAddress")}
              </label>
              <Input
                id="custom-provider-base-url"
                type="url"
                value={draft.baseURL}
                disabled={busy}
                placeholder={t("extensions.modelConfig.apiAddressPlaceholder")}
                className="bg-background h-10"
                onChange={(event) => {
                  const baseURL = event.currentTarget.value;
                  setDraft((current) => ({ ...current, baseURL }));
                }}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-muted-foreground block text-sm">
                {t("extensions.modelConfig.apiProtocol")}
              </label>
              <DropdownMenu>
                <SettingsDropdownTrigger aria-label={t("extensions.modelConfig.apiProtocol")}>
                  <span>{draft.api}</span>
                  <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0" />
                </SettingsDropdownTrigger>
                <SettingsDropdownContent align="start" side="bottom">
                  <DropdownMenuRadioGroup
                    value={draft.api}
                    onValueChange={(api) => {
                      const next = MODEL_PROVIDER_APIS.find((value) => value === api);
                      if (next) setDraft((current) => ({ ...current, api: next }));
                    }}
                  >
                    {MODEL_PROVIDER_APIS.map((api) => (
                      <SettingsDropdownRadioItem key={api} value={api}>
                        {api}
                      </SettingsDropdownRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </SettingsDropdownContent>
              </DropdownMenu>
            </div>
          </div>
        ) : null}

        <div className={`${addMode || customProviderMode ? "mt-3" : ""} space-y-1.5`}>
          <label
            htmlFor={`model-provider-api-key-${mode}`}
            className="text-muted-foreground block text-sm"
          >
            {t("extensions.modelConfig.apiKey")}
          </label>
          <Input
            id={`model-provider-api-key-${mode}`}
            type="password"
            autoComplete="new-password"
            value={draft.apiKey}
            disabled={
              busy ||
              configLoading ||
              (!customProviderMode && !selectedProvider?.apiKeyConfigurable)
            }
            placeholder={
              !customProviderMode && !selectedProvider?.apiKeyConfigurable
                ? t("extensions.modelConfig.environmentOnly")
                : mode === "edit"
                  ? t("extensions.modelConfig.apiKeyEditPlaceholder")
                  : t("extensions.modelConfig.apiKeyPlaceholder")
            }
            className="bg-background h-10"
            onChange={(event) => {
              const apiKey = event.currentTarget.value;
              setDraft((current) => ({ ...current, apiKey }));
            }}
          />
        </div>

        <Collapsible
          open={customProviderMode || draft.customOpen}
          onOpenChange={(open) => {
            if (!customProviderMode) {
              setDraft((current) => ({ ...current, customOpen: open }));
            }
          }}
          className={customProviderMode ? "mt-3 border-t pt-3" : "mt-3 border-t pt-2.5"}
        >
          {!customProviderMode ? (
            <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
              <ChevronRightIcon
                className={`size-4 transition-transform ${draft.customOpen ? "rotate-90" : ""}`}
              />
              {t("extensions.modelConfig.customSettings")}
            </CollapsibleTrigger>
          ) : null}
          <CollapsibleContent className={customProviderMode ? "pt-0" : "pt-3"}>
            {configLoading ? (
              <p className="text-muted-foreground text-sm" role="status">
                {t("extensions.modelConfig.loadingDetails")}
              </p>
            ) : (
              <div>
                {!customProviderMode ? (
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`provider-base-url-${mode}`}
                      className="text-muted-foreground block text-sm"
                    >
                      {t("extensions.modelConfig.apiAddress")}
                    </label>
                    <Input
                      id={`provider-base-url-${mode}`}
                      type="url"
                      value={draft.baseURL}
                      disabled={busy}
                      placeholder={
                        draft.defaultBaseURL || t("extensions.modelConfig.apiAddressPlaceholder")
                      }
                      className="bg-background h-10"
                      onChange={(event) => {
                        const baseURL = event.currentTarget.value;
                        setDraft((current) => ({ ...current, baseURL }));
                      }}
                    />
                  </div>
                ) : null}

                <div className={customProviderMode ? "" : "mt-3 border-t pt-3"}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-muted-foreground text-sm">
                        {t("extensions.modelConfig.modelCatalog")}
                      </p>
                      {!customProviderMode || draft.modelsSource === "custom" ? (
                        <p className="text-muted-foreground mt-1 text-sm">
                          {draft.modelsSource === "adapter"
                            ? t("extensions.modelConfig.adapterDefaultModels")
                            : t("extensions.modelConfig.customModels")}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {draft.modelsSource === "custom" && !customProviderMode ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className="rounded-full"
                          disabled={busy}
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              modelsSource: "adapter",
                              models: [],
                            }))
                          }
                        >
                          {t("extensions.modelConfig.restoreDefaultModels")}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        className="rounded-full"
                        disabled={busy || modelPickerLoading}
                        onClick={() => void openModelPicker()}
                      >
                        {modelPickerLoading
                          ? t("extensions.modelConfig.fetchingAvailableModels")
                          : t("extensions.modelConfig.fetchAvailableModels")}
                      </Button>
                    </div>
                  </div>

                  {draft.modelsSource === "adapter" ? (
                    <div className="text-muted-foreground mt-3 rounded-lg border border-dashed px-3 py-3 text-center text-sm">
                      {t("extensions.modelConfig.adapterCatalogEmpty")}
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {draft.models.map((model, index) => (
                        <div key={model.key}>
                          <div className="rounded-lg border p-1.5">
                            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] gap-1.5">
                              <Input
                                value={model.id}
                                disabled={busy}
                                aria-label={t("extensions.modelConfig.modelId")}
                                placeholder={t("extensions.modelConfig.modelId")}
                                className="bg-background h-8"
                                onChange={(event) =>
                                  updateModel(model.key, { id: event.currentTarget.value })
                                }
                              />
                              <Input
                                value={model.name}
                                disabled={busy}
                                aria-label={t("extensions.modelConfig.modelName")}
                                placeholder={t("extensions.modelConfig.modelName")}
                                className="bg-background h-8"
                                onChange={(event) =>
                                  updateModel(model.key, { name: event.currentTarget.value })
                                }
                              />
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="rounded-full"
                                disabled={busy}
                                aria-label={
                                  model.expanded
                                    ? t("extensions.modelConfig.collapseModel", {
                                        name: model.name || model.id,
                                      })
                                    : t("extensions.modelConfig.expandModel", {
                                        name: model.name || model.id,
                                      })
                                }
                                onClick={() =>
                                  updateModel(model.key, { expanded: !model.expanded }, false)
                                }
                              >
                                {model.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                disabled={busy}
                                aria-label={t("extensions.modelConfig.removeModel", {
                                  name: model.name || model.id,
                                })}
                                className="text-muted-foreground rounded-full hover:text-destructive"
                                onClick={() =>
                                  setDraft((current) => {
                                    const models = current.models.filter(
                                      ({ key }) => key !== model.key,
                                    );
                                    return {
                                      ...current,
                                      modelsSource: models.length > 0 ? "custom" : "adapter",
                                      models,
                                    };
                                  })
                                }
                              >
                                <Trash2Icon />
                              </Button>
                            </div>
                            {model.expanded ? (
                              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                  <label className="text-muted-foreground block text-sm">
                                    {t("extensions.modelConfig.contextWindow")}
                                  </label>
                                  <Input
                                    inputMode="decimal"
                                    value={model.contextWindow}
                                    disabled={busy}
                                    placeholder="1M"
                                    className="bg-background h-10"
                                    onChange={(event) =>
                                      updateModel(model.key, {
                                        contextWindow: event.currentTarget.value,
                                      })
                                    }
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-muted-foreground block text-sm">
                                    {t("extensions.modelConfig.maxOutputTokens")}
                                  </label>
                                  <Input
                                    inputMode="decimal"
                                    value={model.maxTokens}
                                    disabled={busy}
                                    placeholder="256K"
                                    className="bg-background h-10"
                                    onChange={(event) =>
                                      updateModel(model.key, {
                                        maxTokens: event.currentTarget.value,
                                      })
                                    }
                                  />
                                </div>
                              </div>
                            ) : null}
                          </div>
                          {!model.id.trim() ? (
                            <p className="text-muted-foreground mt-1.5 text-sm">
                              {t("extensions.modelConfig.modelIdRequired", { index: index + 1 })}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 rounded-full"
                    disabled={busy}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        modelsSource: "custom",
                        models: [...current.models, emptyModel()],
                      }))
                    }
                  >
                    <PlusIcon />
                    {t("extensions.modelConfig.addModel")}
                  </Button>
                </div>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        {error ? (
          <p className="text-destructive mt-3 text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            disabled={busy}
            onClick={closeEditor}
          >
            {t("extensions.modelConfig.cancel")}
          </Button>
          <Button
            type="button"
            className="rounded-full"
            disabled={
              busy ||
              configLoading ||
              !draft.provider ||
              (customProviderMode && !draft.baseURL.trim())
            }
            onClick={() => void save()}
          >
            {saving
              ? t("extensions.modelConfig.saving")
              : mode === "add-custom"
                ? t("extensions.modelConfig.createProvider")
                : t("extensions.modelConfig.save")}
          </Button>
        </div>
      </div>
    );
  };

  if (loadState === "loading") {
    return (
      <p className="text-muted-foreground py-8 text-sm" role="status">
        {t("extensions.modelConfig.loading")}
      </p>
    );
  }

  if (loadState === "failed") {
    return (
      <div className="py-6">
        <p className="text-destructive text-sm" role="alert">
          {t("extensions.modelConfig.loadFailed")}
        </p>
        <Button type="button" variant="outline" className="mt-3 rounded-full" onClick={load}>
          {t("extensions.modelConfig.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div data-settings-section={sectionId} data-settings-item={itemId} className="space-y-3 pb-2">
      <div className="space-y-1.5">
        {configured.length === 0 && !editor ? (
          <div className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-sm">
            {t("extensions.modelConfig.empty")}
          </div>
        ) : null}
        {configured.map((provider) => (
          <div key={provider.provider} className="space-y-1.5">
            <div className="flex min-h-12 items-center gap-2 rounded-lg border px-3 py-1.5">
              <div className="min-w-0 flex-1">
                <span className="truncate text-sm font-medium" title={provider.displayName}>
                  {provider.displayName}
                </span>
                <span
                  className="ms-2 inline-block size-2.5 rounded-full bg-emerald-500 align-middle"
                  aria-label={t("extensions.modelConfig.configured")}
                  title={t("extensions.modelConfig.configured")}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                aria-expanded={editor?.mode === "edit" && editor.provider === provider.provider}
                disabled={busy}
                onClick={() => editProvider(provider)}
              >
                {t("extensions.modelConfig.edit")}
              </Button>
              {provider.removable ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive rounded-full hover:text-destructive"
                  disabled={busy}
                  onClick={() => void remove(provider.provider)}
                >
                  {removingProviderId === provider.provider
                    ? t("extensions.modelConfig.removing")
                    : t("extensions.modelConfig.delete")}
                </Button>
              ) : null}
            </div>
            {editor?.mode === "edit" && editor.provider === provider.provider
              ? providerEditor("edit")
              : null}
          </div>
        ))}
        {editor?.mode === "add-provider" ? providerEditor("add-provider") : null}
        {editor?.mode === "add-custom" ? providerEditor("add-custom") : null}
      </div>

      {!editor && error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 border-dashed text-sm font-normal"
          disabled={busy || addableProviders.length === 0}
          onClick={addProvider}
        >
          <PlusIcon />
          {t("extensions.modelConfig.addProvider")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-11 border border-dashed text-sm font-normal"
          disabled={busy}
          onClick={addCustomProvider}
        >
          <PlusIcon />
          {t("extensions.modelConfig.addCustomProvider")}
        </Button>
      </div>

      <Dialog
        open={modelPickerOpen}
        onOpenChange={(open) => {
          setModelPickerOpen(open);
          if (!open) {
            modelCatalogRequest.current += 1;
            setModelPickerLoading(false);
            setModelPickerError(undefined);
          }
        }}
      >
        <DialogContent
          closeLabel={t("extensions.modelConfig.closeModelPicker")}
          className="flex max-h-[min(28rem,calc(100dvh-6rem))] w-[calc(100vw-3rem)] max-w-sm flex-col gap-3 rounded-xl p-4 sm:max-w-sm"
        >
          <DialogHeader className="gap-2 pe-8">
            <DialogTitle className="text-lg">
              {t("extensions.modelConfig.selectModelsTitle")}
            </DialogTitle>
            <DialogDescription className="text-sm text-foreground">
              {t("extensions.modelConfig.selectModelsDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-32 flex-1 overflow-y-auto pe-1">
            {modelPickerLoading ? (
              <p className="text-muted-foreground py-8 text-center text-sm" role="status">
                {t("extensions.modelConfig.fetchingAvailableModels")}
              </p>
            ) : modelPickerError ? (
              <p className="text-destructive py-8 text-center text-sm" role="alert">
                {modelPickerError}
              </p>
            ) : draft.availableModels.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                {t("extensions.modelConfig.availableModelsEmpty")}
              </p>
            ) : (
              <div className="space-y-1">
                {draft.availableModels.map((model) => (
                  <label
                    key={model.id}
                    className="hover:bg-muted flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2"
                  >
                    <input
                      type="checkbox"
                      checked={selectedModelIds.has(model.id)}
                      className="size-4 accent-primary"
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setSelectedModelIds((current) => {
                          const next = new Set(current);
                          if (checked) next.add(model.id);
                          else next.delete(model.id);
                          return next;
                        });
                      }}
                    />
                    <span className="font-mono text-sm">{model.id}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={() => setModelPickerOpen(false)}
            >
              {t("extensions.modelConfig.cancel")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              disabled={modelPickerLoading || selectedModelIds.size === 0}
              onClick={addSelectedModels}
            >
              {t("extensions.modelConfig.addSelectedModels")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
