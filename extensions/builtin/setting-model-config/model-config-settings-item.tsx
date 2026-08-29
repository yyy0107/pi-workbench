"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  PlusIcon,
} from "lucide-react";

import { collapsePanel } from "@/components/elements/surfaces";
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
import { Skeleton } from "@/components/ui/skeleton";
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
  testPiModelImageInput,
} from "@/runtime/pi/client/transport/api";
import type {
  ConfigurableProviderView,
  ModelProviderConfiguration,
  ModelProviderLoginValue,
  ModelProviderModelConfiguration,
  ModelProvidersValue,
  TestModelImageInputValue,
} from "@/runtime/pi/contracts/rpc";

import {
  MODEL_PROVIDER_APIS,
  discoveredImageInputConfiguration,
  emptyDraft,
  emptyModel,
  evaluateProviderModelAvailability,
  prepareProviderConfiguration,
  preferredAuthType,
  providerModelsForTest,
  providerTestDiscoverySource,
  restoreAdapterModelDrafts,
  toModelDraft,
  toProviderDraft,
  type ModelDraft,
  type ProviderDraft,
  type ProviderDraftError,
} from "./model-config-draft";
import { ModelCatalogRow, modelTypeMessageKey } from "./model-config-model-row";
import { modelProviderCredentialWebsite } from "./model-provider-credential-links";

type LoadState = "loading" | "ready" | "failed";
type ProviderTestResult = { kind: "success" | "warning" | "error"; message: string };
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
} as const satisfies Record<ProviderDraftError, StaticMessageKey>;

function ProviderEditorSection({
  open,
  summary,
  children,
}: {
  open: boolean;
  summary: ReactNode;
  children: ReactNode;
}) {
  const retainedChildren = useRef<ReactNode>(null);

  useLayoutEffect(() => {
    if (open) retainedChildren.current = children;
  }, [children, open]);

  useEffect(() => {
    if (!open && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      retainedChildren.current = null;
    }
  }, [open]);

  return (
    <Collapsible open={open}>
      {summary}
      <CollapsibleContent
        className={`${collapsePanel} outline-none`}
        onTransitionEnd={(event) => {
          if (!open && event.target === event.currentTarget && event.propertyName === "height") {
            retainedChildren.current = null;
          }
        }}
      >
        <div className="pt-1.5">{open ? children : retainedChildren.current}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

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
  const [testingProvider, setTestingProvider] = useState(false);
  const [providerTestResult, setProviderTestResult] = useState<ProviderTestResult>();
  const [testingModelKey, setTestingModelKey] = useState<number>();
  const [modelImageTestResults, setModelImageTestResults] = useState<
    Record<number, ProviderTestResult>
  >({});
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
  const providerTestRequest = useRef(0);
  const modelImageTestRequest = useRef(0);
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
  const busy = saving || removingProviderId !== undefined;

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
    draft.apiKey,
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
    draft.apiKey,
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
    setEditor(undefined);
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
        startTransition(() => {
          setDraft(toProviderDraft(provider, configuration));
          setConfigLoading(false);
        });
      } catch {
        if (request === configRequest.current) {
          setError(t("extensions.modelConfig.errors.loadDetailsFailed"));
          setConfigLoading(false);
        }
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
      adapterModels: [],
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

  const updateModel = useCallback((key: number, patch: Partial<ModelDraft>) => {
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
        try {
          const discovery = await discoverPiModels({
            ...modelDiscoveryPayload,
            source: "endpoint",
          });
          if (request !== modelImageTestRequest.current) return;
          const discoveredConfiguration = discoveredImageInputConfiguration(
            modelId,
            discovery.models,
          );
          if (discoveredConfiguration) {
            updateModel(model.key, discoveredConfiguration);
            setModelImageTestResults((current) => ({
              ...current,
              [model.key]: {
                kind: discoveredConfiguration.input.includes("image") ? "success" : "warning",
                message: t(
                  discoveredConfiguration.input.includes("image")
                    ? "extensions.modelConfig.multimodalMetadataSupported"
                    : "extensions.modelConfig.multimodalMetadataUnsupported",
                ),
              },
            }));
            return;
          }
        } catch {
          // Model-list metadata is an optimization. Fall back to the inference test below.
        }

        const result = await testPiModelImageInput({ provider, model: modelId });
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
        setModelImageTestResults((current) => ({
          ...current,
          [model.key]: modelImageTestResult(result),
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
    [draft.provider, modelDiscoveryPayload, modelImageTestResult, t, testingModelKey, updateModel],
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
        const result = await discoverPiModels({
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
    [draft.availableModels, modelDiscoveryPayload, t],
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

  const restoreDefaultModels = useCallback(() => {
    setError(undefined);
    setDraft((current) => restoreAdapterModelDrafts(current));
  }, []);

  const refreshLatestAvailableModels = useCallback(async () => {
    const availableModels = await refreshAvailableModels(
      accountAuthentication ? "provider" : "endpoint",
    );
    if (availableModels) updateSelectedModelIds(availableModels);
  }, [accountAuthentication, refreshAvailableModels, updateSelectedModelIds]);

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
      const result = await discoverPiModels({
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
    const selectProvider = (providerId: string) => {
      const provider = providers.find(({ provider: id }) => id === providerId);
      if (provider) void loadProviderConfig(provider);
    };
    return (
      <div className="rounded-xl border p-3 sm:p-4">
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
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <label
                htmlFor={`model-provider-api-key-${mode}`}
                className="text-muted-foreground block text-sm"
              >
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
                      {!customProviderMode ? (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={busy || modelPickerLoading}
                          onClick={restoreDefaultModels}
                        >
                          {t("extensions.modelConfig.restoreDefaultModels")}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={busy || modelPickerLoading}
                        onClick={() => void openModelPicker()}
                      >
                        {modelPickerLoading
                          ? t("extensions.modelConfig.fetchingAvailableModels")
                          : t("extensions.modelConfig.customizeModels")}
                      </Button>
                    </div>
                  </div>

                  {draft.models.length === 0 ? (
                    <div className="text-muted-foreground mt-3 rounded-lg border border-dashed px-3 py-3 text-center text-sm">
                      {t("extensions.modelConfig.availableModelsEmpty")}
                    </div>
                  ) : (
                    <div
                      role="region"
                      aria-label={t("extensions.modelConfig.modelCatalog")}
                      tabIndex={0}
                      className="bg-muted/20 focus-visible:ring-ring/50 mt-3 max-h-[min(34rem,60dvh)] space-y-2 overflow-y-auto overscroll-contain rounded-xl border p-1.5 outline-none focus-visible:ring-3 [scrollbar-gutter:stable]"
                    >
                      {draft.models.map((model, index) => (
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

                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3"
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

        <p className="text-muted-foreground mt-3 text-xs">
          {t(
            accountAuthentication
              ? "extensions.modelConfig.testAccountProviderHint"
              : "extensions.modelConfig.testProviderHint",
          )}
        </p>

        {providerTestResult ? (
          <p
            className={
              providerTestResult.kind === "error"
                ? "text-destructive mt-3 text-sm"
                : providerTestResult.kind === "warning"
                  ? "mt-3 text-sm text-amber-700 dark:text-amber-300"
                  : "mt-3 text-sm text-emerald-700 dark:text-emerald-300"
            }
            role={providerTestResult.kind === "error" ? "alert" : "status"}
          >
            {providerTestResult.message}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={closeEditor}>
            {t("extensions.modelConfig.cancel")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || configLoading || testingProvider || testingModelKey !== undefined}
            onClick={() => void testCurrentProvider()}
          >
            {testingProvider
              ? t("extensions.modelConfig.testingProvider")
              : t("extensions.modelConfig.testProvider")}
          </Button>
          <Button
            type="button"
            disabled={
              busy ||
              configLoading ||
              testingProvider ||
              testingModelKey !== undefined ||
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
        <Button type="button" variant="outline" className="mt-3" onClick={load}>
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
        {configured.map((provider) => {
          const editing = editor?.mode === "edit" && editor.provider === provider.provider;
          const open = editing && !configLoading;
          return (
            <ProviderEditorSection
              key={provider.provider}
              open={open}
              summary={
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
                    aria-expanded={open}
                    aria-busy={editing && configLoading}
                    disabled={busy}
                    onClick={() => editProvider(provider)}
                  >
                    {editing && configLoading ? (
                      <LoaderCircleIcon
                        aria-hidden="true"
                        className="animate-spin motion-reduce:animate-none"
                      />
                    ) : null}
                    {t("extensions.modelConfig.edit")}
                  </Button>
                  {provider.removable ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
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
              }
            >
              {open ? providerEditor("edit") : null}
            </ProviderEditorSection>
          );
        })}
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
                        className="border-border bg-background hover:bg-muted inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--button-radius)] border px-2.5 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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
              disabled={modelPickerLoading || !modelDiscoveryPayload.baseURL}
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
