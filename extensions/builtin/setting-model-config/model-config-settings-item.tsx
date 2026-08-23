"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  SettingsDropdownContent,
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
} from "@/components/ui/settings-control";
import { useI18n, type StaticMessageKey } from "@/i18n";
import type { SettingsItemComponentProps } from "@/platform/extensions";
import {
  cancelPiModelProviderLogin,
  configurePiModelProvider,
  discoverPiModels,
  getPiModelProviderConfig,
  getPiModelProviderLogin,
  listPiModelProviders,
  PiApiError,
  removePiModelProvider,
  respondPiModelProviderLogin,
  startPiModelProviderLogin,
} from "@/runtime/pi/client/transport/api";
import type {
  ConfigurableProviderView,
  ModelProviderConfiguration,
  ModelProviderLoginValue,
  ModelProvidersValue,
} from "@/runtime/pi/rpc-contracts";

import {
  MODEL_PROVIDER_APIS,
  emptyDraft,
  emptyModel,
  prepareProviderConfiguration,
  preferredAuthType,
  toModelDraft,
  toProviderDraft,
  type ModelDraft,
  type ProviderDraft,
  type ProviderDraftError,
} from "./model-config-draft";

type LoadState = "loading" | "ready" | "failed";
type Editor =
  | { mode: "add-provider" }
  | { mode: "add-custom" }
  | { mode: "edit"; provider: string };

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9._-]*$/u;
const PROVIDER_DRAFT_ERROR_KEYS = {
  apiAddressRequired: "extensions.modelConfig.errors.apiAddressRequired",
  modelRequired: "extensions.modelConfig.errors.modelRequired",
  invalidModel: "extensions.modelConfig.errors.invalidModel",
  duplicateModel: "extensions.modelConfig.errors.duplicateModel",
} as const satisfies Record<ProviderDraftError, StaticMessageKey>;

function visibleProviders(value?: ModelProvidersValue): ConfigurableProviderView[] {
  return (
    value?.providers.filter((provider) => provider.configured || provider.configurationDefined) ??
    []
  );
}

function safeExternalUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
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
  const [providerLogin, setProviderLogin] = useState<ModelProviderLoginValue>();
  const [loginStarting, setLoginStarting] = useState(false);
  const [loginResponding, setLoginResponding] = useState(false);
  const [loginPromptValue, setLoginPromptValue] = useState("");
  const [loginError, setLoginError] = useState<string>();
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(() => new Set());
  const configRequest = useRef(0);
  const modelCatalogRequest = useRef(0);
  const refreshedLoginId = useRef<string | undefined>(undefined);

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
          (provider.apiKeyConfigurable ||
            provider.authMethods?.some(({ type }) => type === "oauth")) &&
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
    if (providerLogin?.status === "running") {
      void cancelPiModelProviderLogin({ loginId: providerLogin.loginId }).catch(() => undefined);
    }
    setProviderLogin(undefined);
    setLoginStarting(false);
    setLoginResponding(false);
    setLoginPromptValue("");
    setLoginError(undefined);
    setSelectedModelIds(new Set());
    setError(undefined);
  }, [providerLogin]);

  const loadProviderConfig = useCallback(
    async (provider: ConfigurableProviderView) => {
      const request = ++configRequest.current;
      setConfigLoading(true);
      setError(undefined);
      setDraft({
        ...emptyDraft(provider.provider, preferredAuthType(provider)),
        apiKey: "",
        displayName: provider.displayName,
      });
      try {
        const configuration = await getPiModelProviderConfig({ provider: provider.provider });
        if (request !== configRequest.current) return;
        setDraft(toProviderDraft(provider, configuration));
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
    const first =
      addableProviders.find((provider) =>
        provider.authMethods?.some(({ type }) => type === "oauth"),
      ) ?? addableProviders[0];
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

  const applyProviderLogin = useCallback(
    (next: ModelProviderLoginValue) => {
      setProviderLogin(next);
      if (next.status === "complete" && refreshedLoginId.current !== next.loginId) {
        refreshedLoginId.current = next.loginId;
        void listPiModelProviders().then(applyProviders, () => undefined);
      }
    },
    [applyProviders],
  );

  const startAccountLogin = useCallback(
    async (providerId = draft.provider) => {
      if (loginStarting || providerLogin?.status === "running") return;
      const selectedProvider = providers.find(({ provider }) => provider === providerId);
      if (!selectedProvider?.authMethods?.some(({ type }) => type === "oauth")) {
        setError(t("extensions.modelConfig.errors.accountLoginUnsupported"));
        return;
      }
      setLoginStarting(true);
      setLoginError(undefined);
      setError(undefined);
      setLoginPromptValue("");
      refreshedLoginId.current = undefined;
      try {
        applyProviderLogin(
          await startPiModelProviderLogin({
            provider: selectedProvider.provider,
            authType: "oauth",
          }),
        );
      } catch (failure) {
        setError(
          failure instanceof PiApiError && failure.code === "model-provider-login-in-progress"
            ? t("extensions.modelConfig.errors.loginInProgress")
            : t("extensions.modelConfig.errors.loginStartFailed"),
        );
      } finally {
        setLoginStarting(false);
      }
    },
    [applyProviderLogin, draft.provider, loginStarting, providerLogin?.status, providers, t],
  );

  useEffect(() => {
    if (!providerLogin || providerLogin.status !== "running") return;
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await getPiModelProviderLogin({ loginId: providerLogin.loginId });
        if (disposed) return;
        applyProviderLogin(next);
        if (next.status === "running") timer = window.setTimeout(poll, 700);
      } catch {
        if (!disposed) {
          setLoginError(t("extensions.modelConfig.errors.loginStatusFailed"));
          timer = window.setTimeout(poll, 1_500);
        }
      }
    };
    timer = window.setTimeout(poll, 500);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [applyProviderLogin, providerLogin?.loginId, providerLogin?.status, t]);

  useEffect(() => {
    setLoginPromptValue("");
  }, [providerLogin?.prompt?.id]);

  const respondToProviderLogin = useCallback(
    async (value: string) => {
      if (!providerLogin?.prompt || loginResponding) return;
      setLoginResponding(true);
      setLoginError(undefined);
      try {
        applyProviderLogin(
          await respondPiModelProviderLogin({
            loginId: providerLogin.loginId,
            promptId: providerLogin.prompt.id,
            value,
          }),
        );
        setLoginPromptValue("");
      } catch {
        setLoginError(t("extensions.modelConfig.errors.loginResponseFailed"));
      } finally {
        setLoginResponding(false);
      }
    },
    [applyProviderLogin, loginResponding, providerLogin, t],
  );

  const closeProviderLogin = useCallback(() => {
    if (providerLogin?.status === "running") {
      void cancelPiModelProviderLogin({ loginId: providerLogin.loginId }).catch(() => undefined);
    }
    const complete = providerLogin?.status === "complete";
    setProviderLogin(undefined);
    setLoginPromptValue("");
    setLoginError(undefined);
    if (complete) closeEditor();
  }, [closeEditor, providerLogin]);

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
      editor.mode === "add-custom" ||
      (editor.mode === "edit" && selectedProvider?.kind === "custom");
    if (customProviderMode && !PROVIDER_ID_PATTERN.test(providerId)) {
      setError(t("extensions.modelConfig.errors.invalidProviderId"));
      return;
    }

    let configuration: ModelProviderConfiguration | undefined;
    if (customProviderMode || draft.customOpen) {
      const prepared = prepareProviderConfiguration(draft);
      if (!prepared.ok) {
        setError(t(PROVIDER_DRAFT_ERROR_KEYS[prepared.error]));
        return;
      }
      configuration = prepared.configuration;
    }

    const apiKey = draft.apiKey.trim();
    if (!configuration && !apiKey) {
      const existing = providers.find(({ provider }) => provider === providerId);
      if (!existing?.configured) {
        setError(
          draft.authType === "oauth"
            ? t("extensions.modelConfig.errors.loginRequired")
            : t("extensions.modelConfig.errors.environmentMissing"),
        );
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
      mode === "add-custom" || (mode === "edit" && selectedProvider?.kind === "custom");
    const oauthMethod = selectedProvider?.authMethods?.find(({ type }) => type === "oauth");
    const configurableAuthMethods =
      selectedProvider?.authMethods?.filter(
        ({ type }) =>
          type === "oauth" || (type === "api_key" && selectedProvider.apiKeyConfigurable),
      ) ?? [];
    const accountLoginProviders = addableProviders.filter((provider) =>
      provider.authMethods?.some(({ type }) => type === "oauth"),
    );
    const apiKeyOnlyProviders = addableProviders.filter(
      (provider) =>
        provider.apiKeyConfigurable && !provider.authMethods?.some(({ type }) => type === "oauth"),
    );
    const providerGroups = [
      {
        id: "account-login",
        label: t("extensions.modelConfig.accountLogin"),
        providers: accountLoginProviders,
      },
      {
        id: "api-key",
        label: t("extensions.modelConfig.apiKey"),
        providers: apiKeyOnlyProviders,
      },
    ].filter(({ providers: groupProviders }) => groupProviders.length > 0);
    const selectProvider = (providerId: string) => {
      const provider = providers.find(({ provider: id }) => id === providerId);
      if (provider) void loadProviderConfig(provider);
    };
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
              <SettingsDropdownContent align="start" side="bottom" className="max-h-72 p-0">
                {providerGroups.map((group, groupIndex) => (
                  <div key={group.id} className="pb-1">
                    {groupIndex > 0 ? <DropdownMenuSeparator className="mx-0 my-0" /> : null}
                    <DropdownMenuRadioGroup
                      value={draft.provider}
                      onValueChange={selectProvider}
                      aria-label={group.label}
                    >
                      <DropdownMenuLabel className="bg-popover sticky top-0 z-10 px-2 py-1.5">
                        {group.label}
                      </DropdownMenuLabel>
                      {group.providers.map((provider) => (
                        <SettingsDropdownRadioItem
                          key={provider.provider}
                          value={provider.provider}
                          className="mx-1"
                        >
                          <span className="min-w-0 flex-1 truncate">{provider.displayName}</span>
                        </SettingsDropdownRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </div>
                ))}
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

        {!customProviderMode && configurableAuthMethods.length > 1 ? (
          <div className={`${addMode ? "mt-3" : ""} space-y-1.5`}>
            <label className="text-muted-foreground block text-sm">
              {t("extensions.modelConfig.authenticationMethod")}
            </label>
            <DropdownMenu>
              <SettingsDropdownTrigger
                disabled={busy || configLoading}
                aria-label={t("extensions.modelConfig.authenticationMethod")}
              >
                <span className="min-w-0 truncate text-start">
                  {configurableAuthMethods.find(({ type }) => type === draft.authType)?.label}
                </span>
                <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0" />
              </SettingsDropdownTrigger>
              <SettingsDropdownContent align="start" side="bottom">
                <DropdownMenuRadioGroup
                  value={draft.authType}
                  onValueChange={(authType) => {
                    if (authType === "oauth" || authType === "api_key") {
                      setDraft((current) => ({ ...current, authType, apiKey: "" }));
                    }
                  }}
                >
                  {configurableAuthMethods.map((method) => (
                    <SettingsDropdownRadioItem key={method.type} value={method.type}>
                      {method.label}
                    </SettingsDropdownRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </SettingsDropdownContent>
            </DropdownMenu>
          </div>
        ) : null}

        {!customProviderMode && draft.authType === "oauth" && oauthMethod ? (
          <div
            className={`${addMode || configurableAuthMethods.length > 1 ? "mt-3" : ""} space-y-2 rounded-lg border bg-background/70 p-3`}
          >
            <div>
              <p className="text-sm font-medium">{oauthMethod.label}</p>
              <p className="text-muted-foreground mt-1 text-xs leading-5">
                {t("extensions.modelConfig.accountLoginDescription", {
                  provider: selectedProvider?.displayName ?? draft.provider,
                })}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              disabled={busy || configLoading || loginStarting}
              onClick={() => void startAccountLogin()}
            >
              <ExternalLinkIcon />
              {loginStarting
                ? t("extensions.modelConfig.startingLogin")
                : selectedProvider?.configured && selectedProvider.authType === "oauth"
                  ? t("extensions.modelConfig.signInAgain")
                  : t("extensions.modelConfig.signInWithAccount")}
            </Button>
          </div>
        ) : (
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
        )}

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
                                size="icon-sm"
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
                                size="icon-sm"
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
                                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 sm:col-span-2">
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium">
                                      {t("extensions.modelConfig.imageInput")}
                                    </p>
                                    <p className="text-muted-foreground mt-0.5 text-xs">
                                      {t("extensions.modelConfig.imageInputDescription")}
                                    </p>
                                  </div>
                                  <Switch
                                    checked={model.supportsImages}
                                    disabled={busy}
                                    aria-label={t("extensions.modelConfig.imageInput")}
                                    onCheckedChange={(checked) =>
                                      updateModel(model.key, { supportsImages: checked })
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
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium" title={provider.displayName}>
                    {provider.displayName}
                  </span>
                  <span
                    className="inline-block size-2.5 shrink-0 rounded-full bg-emerald-500"
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {t(
                      provider.authType === "oauth"
                        ? "extensions.modelConfig.accountConfigured"
                        : "extensions.modelConfig.configured",
                    )}
                  </span>
                </div>
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
                    ? t(
                        provider.kind === "custom"
                          ? "extensions.modelConfig.deleting"
                          : "extensions.modelConfig.removing",
                      )
                    : t(
                        provider.kind === "custom"
                          ? "extensions.modelConfig.delete"
                          : "extensions.modelConfig.remove",
                      )}
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
        open={providerLogin !== undefined}
        onOpenChange={(open) => {
          if (!open) closeProviderLogin();
        }}
      >
        <DialogContent
          closeLabel={t("extensions.modelConfig.closeLogin")}
          className="flex max-h-[min(34rem,calc(100dvh-4rem))] w-[calc(100vw-2rem)] max-w-md flex-col gap-3 rounded-xl p-4 sm:max-w-md"
        >
          <DialogHeader className="gap-2 pe-8">
            <DialogTitle className="text-lg">
              {t("extensions.modelConfig.accountLoginTitle", {
                provider:
                  providers.find(({ provider }) => provider === providerLogin?.provider)
                    ?.displayName ??
                  providerLogin?.provider ??
                  "",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("extensions.modelConfig.accountLoginDialogDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-28 flex-1 space-y-3 overflow-y-auto pe-1">
            {providerLogin?.events.map((event, index) => {
              if (event.type === "auth_url") {
                const url = safeExternalUrl(event.url);
                return (
                  <div key={`${event.type}-${index}`} className="space-y-2 rounded-lg border p-3">
                    {event.instructions ? (
                      <p className="text-sm leading-5">{event.instructions}</p>
                    ) : null}
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="border-border bg-background hover:bg-muted inline-flex h-8 items-center justify-center gap-1.5 rounded-full border px-2.5 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <ExternalLinkIcon className="size-4" />
                        {t("extensions.modelConfig.openLoginPage")}
                      </a>
                    ) : null}
                  </div>
                );
              }
              if (event.type === "device_code") {
                const url = safeExternalUrl(event.verificationUri);
                return (
                  <div key={`${event.type}-${index}`} className="space-y-2 rounded-lg border p-3">
                    <p className="text-muted-foreground text-xs">
                      {t("extensions.modelConfig.deviceCode")}
                    </p>
                    <code className="block select-all rounded-md bg-muted px-3 py-2 text-center text-base font-semibold tracking-wider">
                      {event.userCode}
                    </code>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary inline-flex items-center gap-1 text-sm underline underline-offset-4"
                      >
                        <ExternalLinkIcon className="size-3.5" />
                        {t("extensions.modelConfig.openVerificationPage")}
                      </a>
                    ) : null}
                  </div>
                );
              }
              if (event.type === "info") {
                return (
                  <div key={`${event.type}-${index}`} className="space-y-1.5 text-sm leading-5">
                    <p>{event.message}</p>
                    {event.links?.map((link) => {
                      const url = safeExternalUrl(link.url);
                      return url ? (
                        <a
                          key={link.url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary me-3 inline-flex items-center gap-1 underline underline-offset-4"
                        >
                          <ExternalLinkIcon className="size-3.5" />
                          {link.label || t("extensions.modelConfig.openLoginPage")}
                        </a>
                      ) : null;
                    })}
                  </div>
                );
              }
              return (
                <p
                  key={`${event.type}-${index}`}
                  className="text-muted-foreground text-sm leading-5"
                  role="status"
                >
                  {event.message}
                </p>
              );
            })}

            {providerLogin?.status === "running" && providerLogin.prompt ? (
              <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
                <p className="text-sm leading-5">{providerLogin.prompt.message}</p>
                {providerLogin.prompt.type === "select" ? (
                  <div className="space-y-2">
                    {providerLogin.prompt.options?.map((option) => (
                      <Button
                        key={option.id}
                        type="button"
                        variant="outline"
                        className="h-auto w-full justify-start rounded-lg px-3 py-2 text-start whitespace-normal"
                        disabled={loginResponding}
                        onClick={() => void respondToProviderLogin(option.id)}
                      >
                        <span>
                          <span className="block">{option.label}</span>
                          {option.description ? (
                            <span className="text-muted-foreground mt-0.5 block text-xs font-normal">
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                      </Button>
                    ))}
                  </div>
                ) : (
                  <form
                    className="space-y-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (loginPromptValue) void respondToProviderLogin(loginPromptValue);
                    }}
                  >
                    <Input
                      type={providerLogin.prompt.type === "secret" ? "password" : "text"}
                      autoComplete="off"
                      value={loginPromptValue}
                      placeholder={providerLogin.prompt.placeholder}
                      disabled={loginResponding}
                      autoFocus
                      onChange={(event) => setLoginPromptValue(event.currentTarget.value)}
                    />
                    <Button
                      type="submit"
                      className="rounded-full"
                      disabled={loginResponding || !loginPromptValue}
                    >
                      {loginResponding
                        ? t("extensions.modelConfig.continuingLogin")
                        : t("extensions.modelConfig.continueLogin")}
                    </Button>
                  </form>
                )}
              </div>
            ) : null}

            {providerLogin?.status === "running" &&
            providerLogin.events.length === 0 &&
            !providerLogin.prompt ? (
              <p className="text-muted-foreground py-6 text-center text-sm" role="status">
                {t("extensions.modelConfig.preparingLogin")}
              </p>
            ) : null}
            {providerLogin?.status === "complete" ? (
              <p className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                {t("extensions.modelConfig.loginComplete")}
              </p>
            ) : null}
            {providerLogin?.status === "failed" ? (
              <p className="text-destructive rounded-lg bg-destructive/10 p-3 text-sm" role="alert">
                {t("extensions.modelConfig.errors.loginFailed")}
              </p>
            ) : null}
            {loginError ? (
              <p className="text-destructive text-sm" role="alert">
                {loginError}
              </p>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={closeProviderLogin}
            >
              {providerLogin?.status === "running"
                ? t("extensions.modelConfig.cancelLogin")
                : t("extensions.modelConfig.done")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
