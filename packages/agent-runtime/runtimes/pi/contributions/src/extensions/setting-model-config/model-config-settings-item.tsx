"use client";

import { startTransition, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ChevronDownIcon,
  MoreHorizontalIcon,
  ExternalLinkIcon,
  PackageIcon,
  PlusIcon,
} from "lucide-react";

import { useModelTestFeedback } from "./use-model-test-feedback";
import { Button, StatusBadge } from "@workbench/shell/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workbench/shell/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
} from "@workbench/shell/ui";
import { Input } from "@workbench/shell/ui";
import { Skeleton } from "@workbench/shell/ui";
import {
  SettingsDropdownContent,
  SettingsDropdownItem,
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
} from "@workbench/shell/ui";
import { type PiStaticMessageKey, usePiI18n } from "../../i18n";
import type { SettingsItemComponentProps } from "@workbench/extension-sdk";
import { usePiConfigurationClient } from "@workbench/agent-runtime-pi-client/configuration";
import { PiApiError } from "@workbench/agent-runtime-pi-client/errors";
import type {
  ConfigurableProviderView,
  ModelProviderConfiguration,
  ModelProviderLoginValue,
  ModelProviderModelConfiguration,
  ModelProvidersValue,
  TestModelImageInputValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";

import {
  MODEL_PROVIDER_APIS,
  emptyDraft,
  emptyModel,
  evaluateProviderModelAvailability,
  prepareProviderConfiguration,
  parseCapacity,
  preferredAuthType,
  providerModelsForTest,
  providerConfigurationSignature,
  providerDraftSaveSignature,
  reconcileSavedProviderDraft,
  filterModelDrafts,
  providerTestDiscoverySource,
  restoreAdapterModelDrafts,
  toModelDraft,
  toProviderDraft,
  type ModelDraft,
  type ProviderDraft,
  type ProviderDraftError,
} from "./model-config-draft";
import {
  ModelCatalogRow,
  modelTypeMessageKey,
  type ModelCatalogRowTestResult,
} from "./model-config-model-row";
import { useModelConfigAutosave } from "./use-model-config-autosave";
import { modelProviderCredentialWebsite } from "./model-provider-credential-links";

type LoadState = "loading" | "ready" | "failed";
type ProviderTestResult = ModelCatalogRowTestResult;
type Editor =
  | { mode: "add-provider" }
  | { mode: "add-custom" }
  | { mode: "edit"; provider: string };

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9._-]*$/u;
const MODEL_PICKER_SKELETON_ROWS = 5;
const PROVIDER_DRAFT_ERROR_KEYS = {
  apiAddressRequired: "extensions.modelConfig.errors.apiAddressRequired",
  modelRequired: "extensions.modelConfig.errors.modelRequired",
  invalidModel: "extensions.modelConfig.errors.invalidModel",
  duplicateModel: "extensions.modelConfig.errors.duplicateModel",
} as const satisfies Record<ProviderDraftError, PiStaticMessageKey>;

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
  const { number, t } = usePiI18n();
  const domScopeId = useId();
  const configurationClient = usePiConfigurationClient();
  const [value, setValue] = useState<ModelProvidersValue>();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [editor, setEditor] = useState<Editor>();
  const [draft, setDraft] = useState<ProviderDraft>(() => emptyDraft());
  const [initialDraft, setInitialDraft] = useState<ProviderDraft>();
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const initialDraftRef = useRef(initialDraft);
  initialDraftRef.current = initialDraft;
  const [pendingChange, setPendingChange] = useState<() => void>();
  const preferredProviderId = useRef<string | undefined>(undefined);
  const [configLoading, setConfigLoading] = useState(false);
  const [testingProvider, setTestingProvider] = useState(false);
  const [storedProviderTestResult, setProviderTestResult] = useState<ProviderTestResult>();
  const providerTestResult = useModelTestFeedback(storedProviderTestResult);
  const [testingModelKey, setTestingModelKey] = useState<number>();
  const [modelImageTestResults, setModelImageTestResults] = useState<
    Record<number, ProviderTestResult>
  >({});
  const [removingProviderId, setRemovingProviderId] = useState<string>();
  const [error, setError] = useState<string>();
  const [modelQuery, setModelQuery] = useState("");
  const [newModel, setNewModel] = useState<ModelDraft>();
  const [newModelError, setNewModelError] = useState<string>();
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
  const providerTestRequest = useRef(0);
  const modelImageTestRequest = useRef(0);
  const refreshedLoginId = useRef<string | undefined>(undefined);

  const applyProviders = useCallback((next: ModelProvidersValue) => setValue(next), []);

  const load = useCallback(() => {
    setLoadState("loading");
    setError(undefined);
    void configurationClient.listModelProviders().then(
      (next) => {
        applyProviders(next);
        setLoadState("ready");
      },
      () => setLoadState("failed"),
    );
  }, [applyProviders, configurationClient]);

  useEffect(load, [load]);

  const providers = value?.providers ?? [];
  const selectedProvider = providers.find(({ provider }) => provider === draft.provider);
  const customProviderMode =
    editor?.mode === "add-custom" ||
    (editor?.mode === "edit" && selectedProvider?.kind === "custom");
  const providerTestSource = providerTestDiscoverySource(draft.authType);
  const accountAuthentication = providerTestSource === "provider";
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
  const getChangeKey = () => {
    const baseline = initialDraftRef.current;
    const signature = providerDraftSaveSignature(draftRef.current);
    return baseline && signature !== providerDraftSaveSignature(baseline) ? signature : undefined;
  };
  const changeKey = getChangeKey();
  const dirty = changeKey !== undefined;
  const { saving, flushSave } = useModelConfigAutosave({
    changeKey,
    getChangeKey,
    enabled:
      !configLoading && !loginStarting && providerLogin?.status !== "running" && !pendingChange,
    save: () => save(),
  });
  const busy = removingProviderId !== undefined;
  const navigationBusy = busy || saving || loginStarting || providerLogin?.status === "running";
  const requestEditorChange = (action: () => void) => {
    if (navigationBusy) return;
    if (!dirty) action();
    else
      void flushSave().then((saved) => {
        if (saved) action();
        else setPendingChange(() => action);
      });
  };

  const modelDiscoveryPayload = useMemo(() => {
    const baseURL = draft.baseURL.trim() || draft.defaultBaseURL.trim();
    const source = customProviderMode ? "endpoint" : "catalog";
    return {
      settingsNs:
        draft.modelsSource === "adapter" && selectedProvider?.settingsNs
          ? selectedProvider.settingsNs
          : `custom:${draft.provider || "provider"}`,
      ...(selectedProvider ? { provider: draft.provider } : {}),
      ...(baseURL ? { baseURL } : {}),
      api: draft.api,
      source,
      ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
    } as const;
  }, [
    customProviderMode,
    draft.api,
    draft.apiKey,
    draft.baseURL,
    draft.defaultBaseURL,
    draft.modelsSource,
    draft.provider,
    selectedProvider,
  ]);
  const modelImageTestIdentity = draft.models
    .map(({ key, id }) => `${key}:${id.trim()}`)
    .join("\0");

  useEffect(() => {
    providerTestRequest.current += 1;
    setTestingProvider(false);
    setProviderTestResult(undefined);
  }, [
    draft.api,
    draft.authType,
    draft.baseURL,
    draft.defaultBaseURL,
    draft.models,
    draft.modelsSource,
    draft.provider,
    editor?.mode,
  ]);

  useEffect(() => {
    modelImageTestRequest.current += 1;
    setTestingModelKey(undefined);
    setModelImageTestResults({});
  }, [
    draft.api,
    draft.authType,
    draft.baseURL,
    draft.defaultBaseURL,
    draft.provider,
    editor?.mode,
    modelImageTestIdentity,
  ]);

  const closeEditor = useCallback(() => {
    configRequest.current += 1;
    modelCatalogRequest.current += 1;
    providerTestRequest.current += 1;
    modelImageTestRequest.current += 1;
    setNewModel(undefined);
    setNewModelError(undefined);
    setEditor(undefined);
    setInitialDraft(undefined);
    setDraft(emptyDraft());
    setConfigLoading(false);
    setModelPickerOpen(false);
    setModelPickerLoading(false);
    setModelPickerError(undefined);
    setTestingProvider(false);
    setProviderTestResult(undefined);
    setTestingModelKey(undefined);
    setModelImageTestResults({});
    if (providerLogin?.status === "running") {
      void configurationClient
        .cancelModelProviderLogin({ loginId: providerLogin.loginId })
        .catch(() => undefined);
    }
    setProviderLogin(undefined);
    setLoginStarting(false);
    setLoginResponding(false);
    setLoginPromptValue("");
    setLoginError(undefined);
    setSelectedModelIds(new Set());
    setModelQuery("");
    setError(undefined);
  }, [configurationClient, providerLogin]);

  const loadProviderConfig = useCallback(
    async (provider: ConfigurableProviderView) => {
      const request = ++configRequest.current;
      setNewModel(undefined);
      setNewModelError(undefined);
      modelCatalogRequest.current += 1;
      setModelQuery("");
      setModelPickerOpen(false);
      setModelPickerLoading(false);
      setModelPickerError(undefined);
      setConfigLoading(true);
      setInitialDraft(undefined);
      setError(undefined);
      setDraft({
        ...emptyDraft(provider.provider, preferredAuthType(provider)),
        apiKey: "",
        displayName: provider.displayName,
      });
      try {
        const configuration = await configurationClient.getModelProviderConfig({
          provider: provider.provider,
        });
        if (request !== configRequest.current) return;
        startTransition(() => {
          const nextDraft = toProviderDraft(provider, configuration);
          setDraft(nextDraft);
          setInitialDraft(nextDraft);
          setError(
            configuration.catalogRefreshFailed
              ? t("extensions.modelConfig.errors.catalogRefreshFailed")
              : undefined,
          );
          setConfigLoading(false);
        });
      } catch {
        if (request === configRequest.current) {
          setError(t("extensions.modelConfig.errors.loadDetailsFailed"));
          setConfigLoading(false);
        }
      }
    },
    [configurationClient, t],
  );

  const editProvider = useCallback(
    (provider: ConfigurableProviderView) => {
      if (editor?.mode === "edit" && editor.provider === provider.provider) {
        return;
      }
      closeEditor();
      preferredProviderId.current = provider.provider;
      setEditor({ mode: "edit", provider: provider.provider });
      void loadProviderConfig(provider);
    },
    [closeEditor, editor, loadProviderConfig],
  );

  const addProvider = useCallback(() => {
    closeEditor();
    const first =
      addableProviders.find((provider) =>
        provider.authMethods?.some(({ type }) => type === "oauth"),
      ) ?? addableProviders[0];
    setEditor({ mode: "add-provider" });
    setError(undefined);
    if (first) void loadProviderConfig(first);
    else setDraft(emptyDraft());
  }, [addableProviders, closeEditor, loadProviderConfig]);

  const addCustomProvider = useCallback(() => {
    closeEditor();
    setEditor({ mode: "add-custom" });
    const nextDraft: ProviderDraft = {
      ...emptyDraft(),
      modelsSource: "adapter",
      models: [],
      adapterModels: [],
      availableModels: [],
    };
    setDraft(nextDraft);
    setInitialDraft(nextDraft);
    setConfigLoading(false);
    setError(undefined);
  }, [closeEditor]);

  useEffect(() => {
    if (loadState !== "ready" || editor || configured.length === 0) return;
    const provider =
      configured.find(({ provider }) => provider === preferredProviderId.current) ?? configured[0];
    editProvider(provider);
  }, [configured, editProvider, editor, loadState]);

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

  const providerTestErrorLabel = useCallback(
    (failure: unknown, usesAccountAuthentication: boolean) => {
      if (!(failure instanceof PiApiError)) {
        return t(
          usesAccountAuthentication
            ? "extensions.modelConfig.errors.testAccountProviderFailed"
            : "extensions.modelConfig.errors.testProviderFailed",
        );
      }
      if (failure.code === "pi_rpc_transport_failed") {
        return t("extensions.modelConfig.errors.testProviderServiceUnavailable");
      }
      if (failure.code === "pi_rpc_invalid_response") {
        return t("extensions.modelConfig.errors.testProviderInvalidResponse");
      }
      if (failure.code !== "model-discovery-failed") {
        return t(
          usesAccountAuthentication
            ? "extensions.modelConfig.errors.testAccountProviderFailed"
            : "extensions.modelConfig.errors.testProviderFailed",
        );
      }

      switch (failure.details.reason) {
        case "authentication":
          return t(
            usesAccountAuthentication
              ? "extensions.modelConfig.errors.testAccountProviderAuthenticationFailed"
              : "extensions.modelConfig.errors.testProviderAuthenticationFailed",
          );
        case "endpoint-not-found":
          return t("extensions.modelConfig.errors.testProviderEndpointNotFound");
        case "rate-limited":
          return t("extensions.modelConfig.errors.testProviderRateLimited");
        case "provider-unavailable":
          return t("extensions.modelConfig.errors.testProviderUnavailable");
        case "http-error": {
          const status = failure.details.httpStatus;
          return typeof status === "number"
            ? t("extensions.modelConfig.errors.testProviderHttpFailed", { status })
            : t("extensions.modelConfig.errors.testProviderFailed");
        }
        case "invalid-api-key":
          return t("extensions.modelConfig.errors.testProviderInvalidApiKey");
        case "invalid-response":
          return t("extensions.modelConfig.errors.testProviderInvalidResponse");
        case "missing-api-address":
          return t("extensions.modelConfig.errors.apiAddressRequired");
        case "network":
          return t("extensions.modelConfig.errors.testProviderNetworkFailed");
        case "runtime":
          return t("extensions.modelConfig.errors.testProviderRuntimeFailed");
        case "unsupported-protocol":
          return t("extensions.modelConfig.errors.testProviderUnsupportedProtocol");
        default:
          return t(
            usesAccountAuthentication
              ? "extensions.modelConfig.errors.testAccountProviderFailed"
              : "extensions.modelConfig.errors.testProviderFailed",
          );
      }
    },
    [t],
  );

  const applyProviderLogin = useCallback(
    (next: ModelProviderLoginValue) => {
      setProviderLogin(next);
      if (next.status === "complete" && refreshedLoginId.current !== next.loginId) {
        refreshedLoginId.current = next.loginId;
        void configurationClient.listModelProviders().then(applyProviders, () => undefined);
      }
    },
    [applyProviders, configurationClient],
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
          await configurationClient.startModelProviderLogin({
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
    [
      applyProviderLogin,
      configurationClient,
      draft.provider,
      loginStarting,
      providerLogin?.status,
      providers,
      t,
    ],
  );

  useEffect(() => {
    if (!providerLogin || providerLogin.status !== "running") return;
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await configurationClient.getModelProviderLogin({
          loginId: providerLogin.loginId,
        });
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
  }, [applyProviderLogin, configurationClient, providerLogin?.loginId, providerLogin?.status, t]);

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
          await configurationClient.respondModelProviderLogin({
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
    [applyProviderLogin, configurationClient, loginResponding, providerLogin, t],
  );

  const closeProviderLogin = useCallback(() => {
    if (providerLogin?.status === "running") {
      void configurationClient
        .cancelModelProviderLogin({ loginId: providerLogin.loginId })
        .catch(() => undefined);
    }
    const complete = providerLogin?.status === "complete";
    setProviderLogin(undefined);
    setLoginPromptValue("");
    setLoginError(undefined);
    if (complete) closeEditor();
  }, [closeEditor, configurationClient, providerLogin]);

  const save = useCallback(async () => {
    if (!editor || configLoading) return false;
    const request = configRequest.current;
    const draft = draftRef.current;
    const configurationChanged =
      initialDraftRef.current !== undefined &&
      providerConfigurationSignature(draft) !==
        providerConfigurationSignature(initialDraftRef.current);
    const providerId = draft.provider.trim();
    if (!providerId) {
      setError(t("extensions.modelConfig.errors.providerRequired"));
      return false;
    }
    if (editor.mode === "add-custom" && providers.some(({ provider }) => provider === providerId)) {
      setError(t("extensions.modelConfig.errors.providerExists"));
      return false;
    }

    const selectedProvider = providers.find(({ provider }) => provider === providerId);
    const customProviderMode =
      editor.mode === "add-custom" ||
      (editor.mode === "edit" && selectedProvider?.kind === "custom");
    if (customProviderMode && !PROVIDER_ID_PATTERN.test(providerId)) {
      setError(t("extensions.modelConfig.errors.invalidProviderId"));
      return false;
    }

    let configuration: ModelProviderConfiguration | undefined;
    if (customProviderMode || configurationChanged) {
      const prepared = prepareProviderConfiguration(draft);
      if (!prepared.ok) {
        setError(t(PROVIDER_DRAFT_ERROR_KEYS[prepared.error]));
        return false;
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
        return false;
      }
      setError(undefined);
      initialDraftRef.current = draft;
      setInitialDraft(draft);
      return true;
    }

    setError(undefined);
    try {
      const next = await configurationClient.configureModelProvider({
        provider: providerId,
        ...(apiKey ? { apiKey } : {}),
        ...(configuration ? { configuration } : {}),
      });
      preferredProviderId.current = providerId;
      applyProviders(next);
      if (request === configRequest.current) {
        const savedDraft = { ...draft, apiKey: "" };
        initialDraftRef.current = savedDraft;
        draftRef.current = reconcileSavedProviderDraft(draftRef.current, draft);
        setInitialDraft(savedDraft);
        setDraft(draftRef.current);
        setEditor({ mode: "edit", provider: providerId });
      }
      return true;
    } catch (failure) {
      if (request === configRequest.current) setError(errorLabel(failure));
      return false;
    }
  }, [applyProviders, configLoading, configurationClient, editor, errorLabel, providers, t]);

  const remove = useCallback(
    async (providerId: string) => {
      if (busy) return;
      setRemovingProviderId(providerId);
      setError(undefined);
      try {
        applyProviders(await configurationClient.removeModelProvider({ provider: providerId }));
        if (editor?.mode === "edit" && editor.provider === providerId) closeEditor();
      } catch (failure) {
        setError(errorLabel(failure));
      } finally {
        setRemovingProviderId(undefined);
      }
    },
    [applyProviders, busy, closeEditor, configurationClient, editor, errorLabel],
  );

  const updateModel = useCallback((key: number, patch: Partial<ModelDraft>) => {
    setModelQuery("");
    if (
      patch.id !== undefined ||
      patch.input !== undefined ||
      patch.imageInputSource !== undefined
    ) {
      setModelImageTestResults((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
    setDraft((current) => ({
      ...current,
      modelsSource: "custom",
      models: current.models.map((model) => (model.key === key ? { ...model, ...patch } : model)),
    }));
  }, []);

  const removeModel = useCallback((key: number) => {
    setDraft((current) => {
      const models = current.models.filter((model) => model.key !== key);
      return {
        ...current,
        modelsSource: models.length > 0 ? "custom" : "adapter",
        models,
      };
    });
  }, []);

  const selectAvailableModel = useCallback(
    (key: number, configuration: ModelProviderModelConfiguration) => {
      setModelQuery("");
      setModelImageTestResults((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setDraft((current) => ({
        ...current,
        modelsSource: "custom",
        models: current.models.map((model) =>
          model.key === key
            ? { ...toModelDraft(configuration, model.expanded), key: model.key }
            : model,
        ),
      }));
    },
    [],
  );

  const modelImageTestResult = useCallback(
    (result: TestModelImageInputValue): ProviderTestResult => {
      switch (result.outcome) {
        case "supported":
          return {
            kind: "success",
            message: t("extensions.modelConfig.multimodalTestSupported"),
          };
        case "unsupported":
          return {
            kind: "warning",
            message: t("extensions.modelConfig.multimodalTestUnsupported"),
          };
        case "inconclusive":
          switch (result.reason) {
            case "model-not-found":
              return {
                kind: "warning",
                message: t("extensions.modelConfig.multimodalTestSaveFirst"),
              };
            case "runtime-unavailable":
              return {
                kind: "warning",
                message: t("extensions.modelConfig.multimodalTestRuntimeUnavailable"),
              };
            case "unexpected-response":
              return {
                kind: "warning",
                message: t("extensions.modelConfig.multimodalTestUnexpectedResponse"),
              };
            case "authentication":
              return {
                kind: "warning",
                message: t("extensions.modelConfig.multimodalTestAuthentication"),
              };
            case "quota-exceeded":
              return {
                kind: "warning",
                message: t("extensions.modelConfig.multimodalTestQuotaExceeded"),
              };
            case "rate-limited":
              return {
                kind: "warning",
                message: t("extensions.modelConfig.multimodalTestRateLimited"),
              };
            case "timeout":
              return {
                kind: "warning",
                message: t("extensions.modelConfig.multimodalTestTimeout"),
              };
            case "network":
              return {
                kind: "warning",
                message: t("extensions.modelConfig.multimodalTestNetwork"),
              };
            case "provider-unavailable":
              return {
                kind: "warning",
                message: t("extensions.modelConfig.multimodalTestProviderUnavailable"),
              };
            case "protocol-mismatch":
              return {
                kind: "warning",
                message: t("extensions.modelConfig.multimodalTestProtocolMismatch"),
              };
            case "model-unavailable":
              return {
                kind: "warning",
                message: t("extensions.modelConfig.multimodalTestModelUnavailable"),
              };
            case "invalid-image":
              return {
                kind: "warning",
                message: t("extensions.modelConfig.multimodalTestInvalidImage"),
              };
            case "safety":
              return {
                kind: "warning",
                message: t("extensions.modelConfig.multimodalTestSafety"),
              };
            case "provider-error":
              return {
                kind: "warning",
                message: t("extensions.modelConfig.multimodalTestProviderError"),
              };
            default:
              return {
                kind: "warning",
                message: t("extensions.modelConfig.multimodalTestInconclusive"),
              };
          }
      }
    },
    [t],
  );

  const testModelImageInput = useCallback(
    async (model: ModelDraft) => {
      const provider = draft.provider.trim();
      const modelId = model.id.trim();
      if (testingModelKey !== undefined || !provider || !modelId) return;
      const request = ++modelImageTestRequest.current;
      setTestingModelKey(model.key);
      setModelImageTestResults((current) => {
        const next = { ...current };
        delete next[model.key];
        return next;
      });
      try {
        const result = await configurationClient.testModelImageInput({
          provider,
          model: modelId,
          testTextInput: true,
        });
        if (request !== modelImageTestRequest.current) return;
        if (result.outcome === "supported") {
          updateModel(model.key, {
            input: ["text", "image"],
            imageInputSource: "test",
          });
        } else if (result.outcome === "unsupported") {
          updateModel(model.key, {
            input: ["text"],
            imageInputSource: "test",
          });
        }
        const connectionWarning =
          result.reason === "quota-exceeded" || result.reason === "rate-limited";
        setModelImageTestResults((current) => ({
          ...current,
          [model.key]: {
            ...modelImageTestResult(result),
            showConnectionWarning: connectionWarning,
            ...(result.textSupported || connectionWarning
              ? {
                  connection:
                    result.outcome === "supported"
                      ? ("image-supported" as const)
                      : ("connected" as const),
                }
              : {
                  kind: "error" as const,
                  message: t("extensions.modelConfig.textConnectionFailed"),
                }),
          },
        }));
      } catch {
        if (request !== modelImageTestRequest.current) return;
        setModelImageTestResults((current) => ({
          ...current,
          [model.key]: {
            kind: "warning",
            message: t("extensions.modelConfig.multimodalTestServiceUnavailable"),
          },
        }));
      } finally {
        if (request === modelImageTestRequest.current) setTestingModelKey(undefined);
      }
    },
    [configurationClient, draft.provider, modelImageTestResult, t, testingModelKey, updateModel],
  );

  const updateSelectedModelIds = useCallback(
    (availableModels: readonly ModelProviderModelConfiguration[]) => {
      const customIds = new Set(draft.models.map(({ id }) => id.trim()).filter(Boolean));
      setSelectedModelIds(
        new Set(
          availableModels
            .filter(({ id }) => draft.modelsSource === "adapter" || customIds.has(id))
            .map(({ id }) => id),
        ),
      );
    },
    [draft.models, draft.modelsSource],
  );

  const refreshAvailableModels = useCallback(
    async (source?: "provider" | "endpoint") => {
      const request = ++modelCatalogRequest.current;
      setModelPickerLoading(true);
      setModelPickerError(undefined);

      try {
        const result = await configurationClient.discoverModels({
          ...modelDiscoveryPayload,
          ...(source ? { source } : {}),
        });
        if (request !== modelCatalogRequest.current) return undefined;
        setDraft((current) => ({ ...current, availableModels: result.models }));
        return result.models;
      } catch {
        if (request !== modelCatalogRequest.current) return undefined;
        if (!source && draft.availableModels.length > 0) {
          return draft.availableModels;
        }
        setModelPickerError(
          t(
            source
              ? "extensions.modelConfig.errors.fetchLatestModelsFailed"
              : "extensions.modelConfig.errors.fetchModelsFailed",
          ),
        );
        return undefined;
      } finally {
        if (request === modelCatalogRequest.current) setModelPickerLoading(false);
      }
    },
    [configurationClient, draft.availableModels, modelDiscoveryPayload, t],
  );

  const openModelPicker = useCallback(async () => {
    setModelPickerOpen(true);
    setModelPickerError(undefined);
    if (draft.availableModels.length > 0) {
      updateSelectedModelIds(draft.availableModels);
      return;
    }
    const availableModels = await refreshAvailableModels();
    if (!availableModels) return;
    updateSelectedModelIds(availableModels);
  }, [draft.availableModels, refreshAvailableModels, updateSelectedModelIds]);

  const restoreDefaultModels = async () => {
    const provider = selectedProvider;
    if (!provider) return;
    setError(undefined);
    const restored = restoreAdapterModelDrafts(draftRef.current);
    draftRef.current = restored;
    setDraft(restored);
    if (
      (await flushSave()) &&
      !getChangeKey() &&
      draftRef.current.provider === provider.provider &&
      draftRef.current.modelsSource === "adapter"
    ) {
      await loadProviderConfig(provider);
    }
  };

  const refreshLatestAvailableModels = useCallback(async () => {
    const availableModels = await refreshAvailableModels(
      providerTestDiscoverySource(
        draft.authType,
        !customProviderMode &&
          (!draft.baseURL.trim() || draft.baseURL.trim() === draft.defaultBaseURL.trim()),
      ),
    );
    if (availableModels) updateSelectedModelIds(availableModels);
  }, [
    draft.authType,
    draft.baseURL,
    draft.defaultBaseURL,
    customProviderMode,
    refreshAvailableModels,
    updateSelectedModelIds,
  ]);

  const testCurrentProvider = useCallback(async () => {
    if (busy || configLoading || testingProvider) return;
    if (!draft.provider.trim()) {
      setProviderTestResult({
        kind: "error",
        message: t("extensions.modelConfig.errors.providerRequired"),
      });
      return;
    }
    if (
      accountAuthentication &&
      (!selectedProvider?.configured || selectedProvider.authType === "api_key")
    ) {
      setProviderTestResult({
        kind: "error",
        message: t("extensions.modelConfig.errors.loginRequired"),
      });
      return;
    }
    if (!accountAuthentication && !modelDiscoveryPayload.baseURL) {
      setProviderTestResult({
        kind: "error",
        message: t("extensions.modelConfig.errors.apiAddressRequired"),
      });
      return;
    }

    const request = ++providerTestRequest.current;
    setTestingProvider(true);
    setProviderTestResult(undefined);
    try {
      const result = await configurationClient.discoverModels({
        ...modelDiscoveryPayload,
        source: providerTestSource,
      });
      if (request !== providerTestRequest.current) return;
      const { configuredModelIds, unavailableModelIds } = evaluateProviderModelAvailability(
        providerModelsForTest(draft),
        result.models,
      );
      if (configuredModelIds.length === 0) {
        setProviderTestResult({
          kind: "warning",
          message: t(
            accountAuthentication
              ? "extensions.modelConfig.testAccountProviderNoConfiguredModels"
              : "extensions.modelConfig.testProviderNoConfiguredModels",
          ),
        });
      } else if (unavailableModelIds.length > 0) {
        setProviderTestResult({
          kind: "error",
          message: t(
            accountAuthentication
              ? "extensions.modelConfig.testAccountProviderModelsUnavailable"
              : "extensions.modelConfig.testProviderModelsUnavailable",
            { modelIds: unavailableModelIds.join(", ") },
          ),
        });
      } else {
        setProviderTestResult({
          kind: "success",
          message: t(
            accountAuthentication
              ? "extensions.modelConfig.testAccountProviderSucceeded"
              : "extensions.modelConfig.testProviderSucceeded",
            { count: configuredModelIds.length },
          ),
        });
      }
    } catch (failure) {
      if (request !== providerTestRequest.current) return;
      setProviderTestResult({
        kind: "error",
        message: providerTestErrorLabel(failure, accountAuthentication),
      });
    } finally {
      if (request === providerTestRequest.current) setTestingProvider(false);
    }
  }, [
    busy,
    configurationClient,
    configLoading,
    accountAuthentication,
    draft,
    modelDiscoveryPayload,
    providerTestErrorLabel,
    providerTestSource,
    selectedProvider,
    t,
    testingProvider,
  ]);

  const addSelectedModels = useCallback(() => {
    const currentModels = new Map(
      draft.models.filter(({ id }) => id.trim()).map((model) => [model.id.trim(), model]),
    );
    setDraft((current) => ({
      ...current,
      modelsSource: "custom",
      models: current.availableModels
        .filter(({ id }) => selectedModelIds.has(id))
        .map((model) => {
          const existing = currentModels.get(model.id);
          return existing
            ? {
                ...existing,
                ...(model.reasoning === undefined
                  ? {}
                  : {
                      reasoning: model.reasoning,
                      thinkingLevelMap: model.thinkingLevelMap
                        ? { ...model.thinkingLevelMap }
                        : undefined,
                    }),
                input: model.input ? [...model.input] : undefined,
                imageInputSource: model.imageInputSource,
              }
            : toModelDraft(model);
        }),
    }));
    setModelPickerOpen(false);
    setModelPickerError(undefined);
  }, [draft.models, selectedModelIds]);

  const providerEditor = (mode: Editor["mode"]) => {
    const customProviderIdentifierId = `${domScopeId}-custom-provider-id`;
    const customProviderNameId = `${domScopeId}-custom-provider-name`;
    const customProviderBaseUrlId = `${domScopeId}-custom-provider-base-url`;
    const providerApiKeyId = `${domScopeId}-model-provider-api-key-${mode}`;
    const providerBaseUrlId = `${domScopeId}-provider-base-url-${mode}`;
    const addMode = mode === "add-provider";
    const credentialWebsite = modelProviderCredentialWebsite(selectedProvider);
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
    const visibleModels = filterModelDrafts(draft.models, modelQuery);
    const selectProvider = (providerId: string) => {
      const provider = providers.find(({ provider: id }) => id === providerId);
      if (provider) requestEditorChange(() => void loadProviderConfig(provider));
    };
    return (
      <div className="min-w-0">
        {addMode ? (
          <div className="space-y-1.5">
            <label className="text-muted-foreground block text-sm">
              {t("extensions.modelConfig.provider")}
            </label>
            <DropdownMenu>
              <SettingsDropdownTrigger
                disabled={busy || saving || addableProviders.length === 0}
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
              <label
                htmlFor={customProviderIdentifierId}
                className="text-muted-foreground block text-sm"
              >
                {t("extensions.modelConfig.providerId")}
              </label>
              <Input
                id={customProviderIdentifierId}
                value={draft.provider}
                disabled={busy || saving || mode === "edit"}
                placeholder={t("extensions.modelConfig.providerIdPlaceholder")}
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
              <label htmlFor={customProviderNameId} className="text-muted-foreground block text-sm">
                {t("extensions.modelConfig.providerName")}
              </label>
              <Input
                id={customProviderNameId}
                value={draft.displayName}
                disabled={busy}
                placeholder={t("extensions.modelConfig.providerNamePlaceholder")}
                onChange={(event) => {
                  const displayName = event.currentTarget.value;
                  setDraft((current) => ({ ...current, displayName }));
                }}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor={customProviderBaseUrlId}
                className="text-muted-foreground block text-sm"
              >
                {t("extensions.modelConfig.apiAddress")}
              </label>
              <Input
                id={customProviderBaseUrlId}
                type="url"
                value={draft.baseURL}
                disabled={busy}
                placeholder={t("extensions.modelConfig.apiAddressPlaceholder")}
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
            className={`${addMode || configurableAuthMethods.length > 1 ? "mt-3" : ""} space-y-2 rounded-lg border p-3`}
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
              disabled={busy || saving || configLoading || loginStarting}
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
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <label htmlFor={providerApiKeyId} className="text-muted-foreground block text-sm">
                {t("extensions.modelConfig.apiKey")}
              </label>
              {credentialWebsite && selectedProvider ? (
                <a
                  href={credentialWebsite}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary inline-flex items-center gap-1 text-xs font-medium underline underline-offset-4"
                >
                  {t("extensions.modelConfig.openApiKeyPage", {
                    provider: selectedProvider.displayName,
                  })}
                  <ExternalLinkIcon aria-hidden="true" className="size-3 shrink-0" />
                </a>
              ) : null}
            </div>
            <Input
              id={providerApiKeyId}
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
              onChange={(event) => {
                const apiKey = event.currentTarget.value;
                providerTestRequest.current += 1;
                modelImageTestRequest.current += 1;
                setTestingProvider(false);
                setProviderTestResult(undefined);
                setTestingModelKey(undefined);
                setModelImageTestResults({});
                setDraft((current) => ({ ...current, apiKey }));
              }}
            />
          </div>
        )}

        <div className="mt-4">
          <div>
            {!customProviderMode ? (
              <div className="space-y-1.5">
                <label htmlFor={providerBaseUrlId} className="text-muted-foreground block text-sm">
                  {t("extensions.modelConfig.apiAddress")}
                </label>
                <Input
                  id={providerBaseUrlId}
                  type="url"
                  value={draft.baseURL}
                  disabled={busy}
                  placeholder={
                    draft.defaultBaseURL || t("extensions.modelConfig.apiAddressPlaceholder")
                  }
                  onChange={(event) => {
                    const baseURL = event.currentTarget.value;
                    setDraft((current) => ({ ...current, baseURL }));
                  }}
                />
              </div>
            ) : null}

            <div className={customProviderMode ? "" : "mt-3 border-t pt-3"}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-medium">
                    {t("extensions.modelConfig.modelCatalog")}
                    <span className="text-muted-foreground font-normal tabular-nums">
                      {number(draft.models.length)}
                    </span>
                  </h3>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy || modelPickerLoading}
                      />
                    }
                  >
                    <PlusIcon />
                    {t("extensions.modelConfig.addModel")}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-max">
                    <SettingsDropdownItem onClick={() => void openModelPicker()}>
                      {t("extensions.modelConfig.customizeModels")}
                    </SettingsDropdownItem>
                    <SettingsDropdownItem
                      onClick={() => {
                        setModelQuery("");
                        setNewModelError(undefined);
                        setNewModel(emptyModel());
                      }}
                    >
                      {t("extensions.modelConfig.manualModel")}
                    </SettingsDropdownItem>
                    {!customProviderMode ? (
                      <>
                        <DropdownMenuSeparator />
                        <SettingsDropdownItem onClick={() => void restoreDefaultModels()}>
                          {t("extensions.modelConfig.restoreDefaultModels")}
                        </SettingsDropdownItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {draft.models.length > 0 ? (
                <Input
                  type="search"
                  value={modelQuery}
                  aria-label={t("extensions.modelConfig.searchModels")}
                  placeholder={t("extensions.modelConfig.searchModels")}
                  onChange={(event) => setModelQuery(event.currentTarget.value)}
                  className="mt-3"
                />
              ) : null}

              {newModel ? (
                <ModelCatalogRow
                  key={newModel.key}
                  model={newModel}
                  index={draft.models.length}
                  configuredModels={draft.models}
                  availableModels={draft.availableModels}
                  busy={busy}
                  modelPickerLoading={modelPickerLoading}
                  modelPickerError={modelPickerError}
                  providerReadyForTest={false}
                  testingDisabled
                  testing={false}
                  onUpdateModel={(_key, patch) => {
                    setNewModelError(undefined);
                    setNewModel((current) => (current ? { ...current, ...patch } : current));
                  }}
                  onSelectAvailableModel={(_key, configuration) => {
                    setNewModelError(undefined);
                    setNewModel((current) =>
                      current
                        ? { ...toModelDraft(configuration, true), key: current.key }
                        : current,
                    );
                  }}
                  onRefreshAvailableModels={refreshAvailableModels}
                  onTestModelImageInput={testModelImageInput}
                  onRemoveModel={() => setNewModel(undefined)}
                  completionError={newModelError}
                  onComplete={() => {
                    if (
                      !newModel.id.trim() ||
                      (newModel.contextWindow.trim() && !parseCapacity(newModel.contextWindow)) ||
                      (newModel.maxTokens.trim() && !parseCapacity(newModel.maxTokens))
                    ) {
                      setNewModelError(t("extensions.modelConfig.errors.invalidModel"));
                      return;
                    }
                    if (draft.models.some((model) => model.id.trim() === newModel.id.trim())) {
                      setNewModelError(t("extensions.modelConfig.errors.duplicateModel"));
                      return;
                    }
                    setDraft((current) => ({
                      ...current,
                      modelsSource: "custom",
                      models: [
                        ...current.models,
                        { ...newModel, id: newModel.id.trim(), expanded: false },
                      ],
                    }));
                    setNewModel(undefined);
                  }}
                />
              ) : null}

              {draft.models.length === 0 ? (
                <div className="text-muted-foreground mt-3 rounded-lg border border-dashed px-3 py-3 text-center text-sm">
                  {t("extensions.modelConfig.availableModelsEmpty")}
                </div>
              ) : visibleModels.length === 0 ? (
                <p role="status" className="text-muted-foreground py-6 text-center text-sm">
                  {t("extensions.modelConfig.noMatchingModels")}
                </p>
              ) : (
                <div
                  role="region"
                  aria-label={t("extensions.modelConfig.modelCatalog")}
                  className="mt-3 min-w-0 space-y-2"
                >
                  {visibleModels.map(({ model, index }) => (
                    <ModelCatalogRow
                      key={model.key}
                      model={model}
                      index={index}
                      configuredModels={draft.models}
                      availableModels={draft.availableModels}
                      busy={busy}
                      modelPickerLoading={modelPickerLoading}
                      modelPickerError={modelPickerError}
                      providerReadyForTest={Boolean(draft.provider.trim())}
                      testingDisabled={testingModelKey !== undefined}
                      testing={testingModelKey === model.key}
                      testResult={modelImageTestResults[model.key]}
                      onUpdateModel={updateModel}
                      onSelectAvailableModel={selectAvailableModel}
                      onRefreshAvailableModels={refreshAvailableModels}
                      onTestModelImageInput={testModelImageInput}
                      onRemoveModel={removeModel}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {error ? (
          <p className="text-destructive mt-3 text-sm" role="alert">
            {error}
          </p>
        ) : null}

        {testingProvider || providerTestResult ? (
          <div
            className="mt-3 border-t border-border pt-3"
            role={providerTestResult?.kind === "error" ? "alert" : "status"}
          >
            <StatusBadge
              tone={
                testingProvider
                  ? "info"
                  : providerTestResult?.kind === "error"
                    ? "danger"
                    : providerTestResult?.kind
              }
              title={providerTestResult?.message}
              className="rounded-[var(--button-radius)] px-2 py-1 text-sm leading-5"
            >
              {testingProvider
                ? t("extensions.modelConfig.testingProvider")
                : providerTestResult?.kind === "success"
                  ? t("extensions.modelConfig.connectionSucceeded")
                  : providerTestResult?.message}
            </StatusBadge>
          </div>
        ) : null}

        {saving || dirty ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span role="status" aria-live="polite">
              {t(
                saving ? "extensions.modelConfig.saving" : "extensions.modelConfig.autoSavePending",
              )}
            </span>
            {dirty && error && !saving ? (
              <Button type="button" variant="ghost" size="xs" onClick={() => void flushSave()}>
                {t("extensions.modelConfig.retry")}
              </Button>
            ) : null}
          </div>
        ) : null}
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
        <Button type="button" variant="outline" className="mt-3" onClick={load}>
          {t("extensions.modelConfig.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div data-settings-section={sectionId} data-settings-item={itemId} className="@container pb-2">
      <div className="grid min-w-0 grid-cols-[var(--icon-frame-size-default)_minmax(0,1fr)] gap-3 @3xl:grid-cols-[12rem_minmax(0,1fr)] @3xl:gap-4">
        <aside
          className="sticky top-0 min-w-0 self-start"
          aria-label={t("extensions.modelConfig.provider")}
        >
          <div className="mb-3 hidden items-center justify-between px-2 text-xs font-medium text-muted-foreground @3xl:flex">
            <span className="sr-only @3xl:not-sr-only">{t("extensions.modelConfig.provider")}</span>
            <span className="tabular-nums">{number(configured.length)}</span>
          </div>
          <div className="space-y-1">
            {configured.map((provider) => (
              <Button
                key={provider.provider}
                type="button"
                variant="ghost"
                disabled={navigationBusy}
                data-selection="none"
                title={provider.displayName}
                aria-pressed={editor?.mode === "edit" && editor.provider === provider.provider}
                onClick={() => {
                  if (editor?.mode !== "edit" || editor.provider !== provider.provider) {
                    requestEditorChange(() => editProvider(provider));
                  }
                }}
                className="relative h-[var(--icon-frame-size-default)] w-full justify-center gap-0 px-0 py-0 text-start aria-pressed:border-border @3xl:justify-start @3xl:gap-2 @3xl:px-3"
              >
                <PackageIcon aria-hidden="true" className="size-[var(--icon-size-lg)] shrink-0" />
                <span className="sr-only min-w-0 @3xl:not-sr-only @3xl:flex-1">
                  <span className="block truncate">{provider.displayName}</span>
                </span>
                <span
                  aria-hidden="true"
                  className={
                    provider.configured
                      ? "absolute end-1 bottom-1 size-[calc(var(--icon-size-md)/2)] shrink-0 rounded-full bg-success ring-2 ring-background @3xl:static @3xl:ms-auto @3xl:ring-0"
                      : "absolute end-1 bottom-1 size-[calc(var(--icon-size-md)/2)] shrink-0 rounded-full bg-muted-foreground ring-2 ring-background @3xl:static @3xl:ms-auto @3xl:ring-0"
                  }
                />
                <span className="sr-only">
                  {t(
                    !provider.configured
                      ? "extensions.modelConfig.authenticationRequired"
                      : provider.authType === "oauth"
                        ? "extensions.modelConfig.accountConfigured"
                        : "extensions.modelConfig.configured",
                  )}
                </span>
              </Button>
            ))}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  disabled={navigationBusy}
                  aria-label={t("extensions.modelConfig.addProvider")}
                  title={t("extensions.modelConfig.addProvider")}
                  className="mt-1 h-[var(--icon-frame-size-default)] w-full justify-center px-0 @3xl:justify-start @3xl:px-3"
                />
              }
            >
              <PlusIcon aria-hidden="true" />
              <span className="sr-only @3xl:not-sr-only">
                {t("extensions.modelConfig.addProvider")}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-max">
              <SettingsDropdownItem
                disabled={addableProviders.length === 0}
                onClick={() => requestEditorChange(addProvider)}
              >
                {t("extensions.modelConfig.addProvider")}
              </SettingsDropdownItem>
              <SettingsDropdownItem onClick={() => requestEditorChange(addCustomProvider)}>
                {t("extensions.modelConfig.addCustomProvider")}
              </SettingsDropdownItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </aside>
        <div className="min-w-0 border-l border-border pl-3 @3xl:pl-4">
          {editor ? (
            <>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="min-w-0 truncate text-base font-semibold">
                  {editor.mode === "edit"
                    ? selectedProvider?.displayName
                    : t(
                        editor.mode === "add-custom"
                          ? "extensions.modelConfig.addCustomProvider"
                          : "extensions.modelConfig.addProvider",
                      )}
                </h2>
                {editor.mode === "edit" && selectedProvider ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          disabled={navigationBusy}
                          aria-label={t("extensions.modelConfig.providerActions")}
                        />
                      }
                    >
                      <MoreHorizontalIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <SettingsDropdownItem
                        disabled={
                          busy || configLoading || testingProvider || testingModelKey !== undefined
                        }
                        onClick={() => void testCurrentProvider()}
                      >
                        {t("extensions.modelConfig.testProvider")}
                      </SettingsDropdownItem>
                      {selectedProvider.removable && (
                        <SettingsDropdownItem
                          onClick={() =>
                            requestEditorChange(() => void remove(selectedProvider.provider))
                          }
                        >
                          {t(
                            selectedProvider.kind === "custom"
                              ? "extensions.modelConfig.delete"
                              : "extensions.modelConfig.remove",
                          )}
                        </SettingsDropdownItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
              {configLoading ? (
                <p role="status" className="text-muted-foreground py-6 text-sm">
                  {t("extensions.modelConfig.loadingDetails")}
                </p>
              ) : initialDraft ? (
                providerEditor(editor.mode)
              ) : (
                <div className="space-y-3">
                  <p role="alert" className="text-destructive text-sm">
                    {error}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (selectedProvider) void loadProviderConfig(selectedProvider);
                    }}
                  >
                    {t("extensions.modelConfig.retry")}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground rounded-[var(--button-radius)] border border-dashed p-6 text-sm">
              {t("extensions.modelConfig.empty")}
            </p>
          )}
          {!editor && error ? (
            <p className="text-destructive mt-3 text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
      <Dialog
        open={pendingChange !== undefined}
        onOpenChange={(open) => {
          if (!open) setPendingChange(undefined);
        }}
      >
        <DialogContent closeLabel={t("extensions.modelConfig.cancel")}>
          <DialogHeader>
            <DialogTitle>{t("extensions.modelConfig.discardTitle")}</DialogTitle>
            <DialogDescription>{t("extensions.modelConfig.discardDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPendingChange(undefined)}>
              {t("extensions.modelConfig.keepEditing")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                const action = pendingChange;
                setPendingChange(undefined);
                action?.();
              }}
            >
              {t("extensions.modelConfig.discard")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
                        className="border-border bg-background hover:bg-muted inline-flex h-[var(--button-height-default)] items-center justify-center gap-1.5 rounded-[var(--button-radius)] border px-2.5 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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
              <div className="space-y-2 rounded-lg border p-3">
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
                    <Button type="submit" disabled={loginResponding || !loginPromptValue}>
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
            <Button type="button" variant="outline" onClick={closeProviderLogin}>
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

          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={
                modelPickerLoading || (customProviderMode && !modelDiscoveryPayload.baseURL)
              }
              onClick={() => void refreshLatestAvailableModels()}
            >
              {t(
                modelPickerLoading
                  ? "extensions.modelConfig.fetchingLatestProviderModels"
                  : "extensions.modelConfig.fetchLatestProviderModels",
              )}
            </Button>
          </div>

          <div className="min-h-32 flex-1 basis-56 overflow-y-auto pe-1 [scrollbar-gutter:stable]">
            {modelPickerLoading ? (
              <div role="status" aria-label={t("extensions.modelConfig.fetchingAvailableModels")}>
                <span className="sr-only">
                  {t("extensions.modelConfig.fetchingAvailableModels")}
                </span>
                <div className="space-y-1" aria-hidden="true">
                  {Array.from({ length: MODEL_PICKER_SKELETON_ROWS }, (_, index) => (
                    <div key={index} className="flex min-h-9 items-center gap-2 rounded-md px-2">
                      <Skeleton className="size-4 shrink-0 rounded-sm" />
                      <Skeleton className="h-4 min-w-0 flex-1" />
                      <Skeleton className="h-3 w-12 shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {modelPickerError ? (
                  <p className="text-destructive pb-3 text-center text-sm" role="alert">
                    {modelPickerError}
                  </p>
                ) : null}
                {draft.availableModels.length === 0 ? (
                  modelPickerError ? null : (
                    <p className="text-muted-foreground py-8 text-center text-sm">
                      {t("extensions.modelConfig.availableModelsEmpty")}
                    </p>
                  )
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
                        <span className="min-w-0 flex-1 truncate font-mono text-sm">
                          {model.id}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-xs">
                          {t(modelTypeMessageKey(model.input, model.imageInputSource))}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setModelPickerOpen(false)}>
              {t("extensions.modelConfig.cancel")}
            </Button>
            <Button
              type="button"
              variant="outline"
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
