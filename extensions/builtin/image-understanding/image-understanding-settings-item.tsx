"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";

import { WorkbenchCodeEditor } from "@/components/code-highlighting";
import { Button } from "@/components/ui/button";
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
  describeAttachmentUnderstandingSettings,
  listPiModelCatalog,
  listPiModelProviders,
  PiApiError,
  updateAttachmentUnderstandingSettings,
} from "@/runtime/pi/client/transport/api";
import {
  getPiModelCatalogRevision,
  subscribePiModelCatalogInvalidation,
} from "@/runtime/pi/client/models/model-catalog-invalidation";
import type {
  AttachmentUnderstandingDescribeValue,
  AttachmentUnderstandingEngine,
  AttachmentUnderstandingRouting,
  AttachmentUnderstandingSettingsValue,
} from "@/runtime/pi/rpc-contracts";
import {
  getOcrAdapterPreset,
  OCR_ADAPTER_PRESETS,
  parseOcrAdapterSource,
  type OcrAdapterPresetId,
} from "@/runtime/image-understanding/ocr-adapter";

import {
  configuredMultimodalModelOptions,
  type MultimodalProviderOption,
} from "./image-understanding-model-options";
import { ocrCredentialWebsiteForPreset } from "./image-understanding-credential-link";
import {
  hasOcrAdapterSettings,
  ocrAdapterSettingsFromValue,
} from "./image-understanding-settings-compat";

type LoadState = "loading" | "ready" | "failed";
type ModelCatalogLoadState = "loading" | "ready" | "failed";
type AttachmentUnderstandingRoutingChoice = Exclude<AttachmentUnderstandingRouting, "auto">;

interface SettingsDraft {
  routing: AttachmentUnderstandingRoutingChoice;
  engine: AttachmentUnderstandingEngine;
  ocrAdapterPreset: OcrAdapterPresetId;
  ocrAdapterSource: string;
  ocrEndpoint: string;
  ocrModel: string;
  ocrApiKey: string;
  clearOcrCredential: boolean;
  ocrPollIntervalMs: string;
  ocrPollTimeoutMs: string;
  multimodalProvider: string;
  multimodalModel: string;
}

interface ChoiceOption<TValue extends string> {
  readonly value: TValue;
  readonly label: string;
}

function draftFromValue(value: AttachmentUnderstandingSettingsValue): SettingsDraft {
  const adapter = ocrAdapterSettingsFromValue(value);
  return {
    // Keep accepting historical `auto` values from the wire, but only expose explicit choices.
    routing: value.routing === "auto" ? "always-preprocess" : value.routing,
    engine: value.engine,
    ocrAdapterPreset: adapter.preset,
    ocrAdapterSource: adapter.source,
    ocrEndpoint: adapter.endpoint,
    ocrModel: adapter.model,
    ocrApiKey: "",
    clearOcrCredential: false,
    ocrPollIntervalMs: String(adapter.pollIntervalMs),
    ocrPollTimeoutMs: String(adapter.pollTimeoutMs),
    multimodalProvider: value.multimodal.provider,
    multimodalModel: value.multimodal.model,
  };
}

function settingsDirty(view: AttachmentUnderstandingDescribeValue, draft: SettingsDraft): boolean {
  const value = view.value;
  const adapter = ocrAdapterSettingsFromValue(value);
  return (
    draft.routing !== value.routing ||
    draft.engine !== value.engine ||
    draft.ocrAdapterPreset !== adapter.preset ||
    draft.ocrAdapterSource !== adapter.source ||
    draft.ocrEndpoint !== adapter.endpoint ||
    draft.ocrModel !== adapter.model ||
    draft.ocrApiKey.length > 0 ||
    draft.clearOcrCredential ||
    draft.ocrPollIntervalMs !== String(adapter.pollIntervalMs) ||
    draft.ocrPollTimeoutMs !== String(adapter.pollTimeoutMs) ||
    draft.multimodalProvider !== value.multimodal.provider ||
    draft.multimodalModel !== value.multimodal.model
  );
}

function isHttpsEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function parsePositiveInteger(value: string): number | undefined {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function ChoiceControl<TValue extends string>({
  id,
  label,
  value,
  options,
  disabled,
  placeholder,
  emptyMessage,
  emptyAlert,
  align = "end",
  triggerClassName,
  contentClassName,
  onOpenChange,
  onChange,
}: {
  id?: string;
  label: string;
  value: TValue;
  options: readonly ChoiceOption<TValue>[];
  disabled?: boolean;
  placeholder?: string;
  emptyMessage?: string;
  emptyAlert?: boolean;
  align?: "start" | "center" | "end";
  triggerClassName?: string;
  contentClassName?: string;
  onOpenChange?(open: boolean): void;
  onChange(value: TValue): void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <SettingsDropdownTrigger
        id={id}
        aria-label={label}
        className={triggerClassName}
        disabled={disabled}
      >
        <span className="truncate">{selected?.label ?? (value || placeholder)}</span>
        <ChevronDownIcon aria-hidden="true" className="size-3.5" />
      </SettingsDropdownTrigger>
      <SettingsDropdownContent align={align} side="bottom" className={contentClassName}>
        {options.length > 0 ? (
          <DropdownMenuRadioGroup
            value={value}
            aria-label={label}
            onValueChange={(next) => {
              const option = options.find(({ value: candidate }) => candidate === next);
              if (option) onChange(option.value);
            }}
          >
            {options.map((option) => (
              <SettingsDropdownRadioItem key={option.value} value={option.value}>
                <span className="truncate" title={option.label}>
                  {option.label}
                </span>
              </SettingsDropdownRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        ) : emptyMessage ? (
          <p
            role={emptyAlert ? "alert" : "status"}
            className="text-muted-foreground max-w-72 px-2.5 py-2 text-xs leading-5"
          >
            {emptyMessage}
          </p>
        ) : null}
      </SettingsDropdownContent>
    </DropdownMenu>
  );
}

function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 sm:max-w-[65%]">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground mt-1 text-xs leading-5">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Field({
  id,
  label,
  labelAction,
  description,
  children,
}: {
  id: string;
  label: string;
  labelAction?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {labelAction}
      </div>
      {description ? (
        <p id={descriptionId} className="text-muted-foreground mt-1 text-xs leading-5">
          {description}
        </p>
      ) : null}
      <div className="mt-auto pt-2">{children}</div>
    </div>
  );
}

export function AttachmentUnderstandingSettingsItem({
  sectionId,
  itemId,
}: SettingsItemComponentProps) {
  const { t } = useI18n();
  const [view, setView] = useState<AttachmentUnderstandingDescribeValue>();
  const [draft, setDraft] = useState<SettingsDraft>();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const requestRef = useRef(0);
  const [modelCatalogLoadState, setModelCatalogLoadState] =
    useState<ModelCatalogLoadState>("loading");
  const [multimodalProviders, setMultimodalProviders] = useState<
    readonly MultimodalProviderOption[]
  >([]);
  const modelCatalogRequestRef = useRef(0);
  const modelCatalogRevision = useSyncExternalStore(
    subscribePiModelCatalogInvalidation,
    getPiModelCatalogRevision,
    getPiModelCatalogRevision,
  );

  const load = useCallback(() => {
    const request = ++requestRef.current;
    setLoadState("loading");
    setSaveError(undefined);
    void describeAttachmentUnderstandingSettings().then(
      (next) => {
        if (request !== requestRef.current) return;
        setView(next);
        setDraft(draftFromValue(next.value));
        setLoadState("ready");
      },
      () => {
        if (request === requestRef.current) setLoadState("failed");
      },
    );
  }, []);

  useEffect(() => {
    load();
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  const loadModelCatalog = useCallback(() => {
    const request = ++modelCatalogRequestRef.current;
    setModelCatalogLoadState("loading");
    void Promise.all([listPiModelProviders(), listPiModelCatalog()]).then(
      ([directory, catalog]) => {
        if (request !== modelCatalogRequestRef.current) return;
        setMultimodalProviders(configuredMultimodalModelOptions(directory, catalog));
        setModelCatalogLoadState("ready");
      },
      () => {
        if (request === modelCatalogRequestRef.current) setModelCatalogLoadState("failed");
      },
    );
  }, []);

  useEffect(() => {
    loadModelCatalog();
    return () => {
      modelCatalogRequestRef.current += 1;
    };
  }, [loadModelCatalog, modelCatalogRevision]);

  const updateDraft = useCallback((patch: Partial<SettingsDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setSaved(false);
    setSaveError(undefined);
  }, []);

  const routingOptions = useMemo<readonly ChoiceOption<AttachmentUnderstandingRoutingChoice>[]>(
    () => [
      {
        value: "always-preprocess",
        label: t("extensions.imageUnderstanding.settings.routing.options.alwaysPreprocess"),
      },
      {
        value: "native-only",
        label: t("extensions.imageUnderstanding.settings.routing.options.nativeOnly"),
      },
      {
        value: "disabled",
        label: t("extensions.imageUnderstanding.settings.routing.options.disabled"),
      },
    ],
    [t],
  );
  const engineOptions = useMemo<readonly ChoiceOption<AttachmentUnderstandingEngine>[]>(
    () => [
      { value: "ocr", label: t("extensions.imageUnderstanding.settings.engine.options.ocr") },
      {
        value: "multimodal",
        label: t("extensions.imageUnderstanding.settings.engine.options.multimodal"),
      },
    ],
    [t],
  );
  const ocrAdapterOptions = useMemo<readonly ChoiceOption<OcrAdapterPresetId>[]>(
    () => [
      {
        value: "glm-ocr",
        label: t("extensions.imageUnderstanding.settings.ocrAdapter.options.glm"),
      },
      {
        value: "paddleocr-vl-1.6",
        label: t("extensions.imageUnderstanding.settings.ocrAdapter.options.paddleVl16"),
      },
      {
        value: "pp-ocrv6",
        label: t("extensions.imageUnderstanding.settings.ocrAdapter.options.ppOcrV6"),
      },
      {
        value: "pp-structure-v3",
        label: t("extensions.imageUnderstanding.settings.ocrAdapter.options.ppStructureV3"),
      },
      {
        value: "custom",
        label: t("extensions.imageUnderstanding.settings.ocrAdapter.options.custom"),
      },
    ],
    [t],
  );
  const selectedMultimodalProvider = multimodalProviders.find(
    (provider) => provider.value === draft?.multimodalProvider,
  );
  const adapterProtocolAvailable = view ? hasOcrAdapterSettings(view.value) : false;

  const validationError = useMemo(() => {
    if (!draft) return undefined;
    if (
      draft.engine === "ocr" &&
      draft.routing !== "disabled" &&
      draft.routing !== "native-only" &&
      !adapterProtocolAvailable
    ) {
      return t("extensions.imageUnderstanding.settings.errors.hostRestartRequired");
    }
    if (!draft.ocrEndpoint.trim() || !draft.ocrModel.trim() || !draft.ocrAdapterSource.trim()) {
      return t("extensions.imageUnderstanding.settings.errors.requiredFields");
    }
    if (!isHttpsEndpoint(draft.ocrEndpoint)) {
      return t("extensions.imageUnderstanding.settings.errors.invalidEndpoint");
    }
    if (
      !parsePositiveInteger(draft.ocrPollIntervalMs) ||
      !parsePositiveInteger(draft.ocrPollTimeoutMs)
    ) {
      return t("extensions.imageUnderstanding.settings.errors.invalidPolling");
    }
    try {
      parseOcrAdapterSource(draft.ocrAdapterSource);
    } catch {
      return t("extensions.imageUnderstanding.settings.errors.invalidAdapterSource");
    }
    if (draft.routing === "disabled" || draft.routing === "native-only") return undefined;
    if (draft.engine === "multimodal") {
      if (modelCatalogLoadState === "loading") return undefined;
      if (modelCatalogLoadState === "failed") {
        return t("extensions.imageUnderstanding.settings.errors.modelCatalogLoadFailed");
      }
      const provider = multimodalProviders.find(
        (candidate) => candidate.value === draft.multimodalProvider,
      );
      if (!provider) {
        return t("extensions.imageUnderstanding.settings.errors.configuredProviderRequired");
      }
      return provider.models.some((model) => model.value === draft.multimodalModel)
        ? undefined
        : t("extensions.imageUnderstanding.settings.errors.configuredModelRequired");
    }
    return undefined;
  }, [adapterProtocolAvailable, draft, modelCatalogLoadState, multimodalProviders, t]);

  const save = useCallback(async () => {
    if (!view || !draft || saving || validationError) return;
    const pollIntervalMs = parsePositiveInteger(draft.ocrPollIntervalMs);
    const pollTimeoutMs = parsePositiveInteger(draft.ocrPollTimeoutMs);
    if (!pollIntervalMs || !pollTimeoutMs) return;

    setSaving(true);
    setSaved(false);
    setSaveError(undefined);
    try {
      const updated = await updateAttachmentUnderstandingSettings({
        expectedRevision: view.revision,
        patch: {
          routing: draft.routing,
          engine: draft.engine,
          ocrAdapter: {
            preset: draft.ocrAdapterPreset,
            source: draft.ocrAdapterSource,
            endpoint: draft.ocrEndpoint.trim(),
            model: draft.ocrModel.trim(),
            pollIntervalMs,
            pollTimeoutMs,
            ...(draft.ocrApiKey
              ? { apiKey: draft.ocrApiKey }
              : draft.clearOcrCredential
                ? { apiKey: null }
                : {}),
          },
          multimodal: {
            provider: draft.multimodalProvider.trim(),
            model: draft.multimodalModel.trim(),
          },
        },
      });
      setView(updated);
      setDraft(draftFromValue(updated.value));
      setSaved(true);
    } catch (error) {
      setSaveError(
        error instanceof PiApiError &&
          (error.code === "image-settings-conflict" || error.code === "settings-conflict")
          ? t("extensions.imageUnderstanding.settings.errors.conflict")
          : t("extensions.imageUnderstanding.settings.errors.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }, [draft, saving, t, validationError, view]);

  if (loadState === "loading") {
    return (
      <p className="text-muted-foreground py-8 text-sm" role="status">
        {t("extensions.imageUnderstanding.settings.loading")}
      </p>
    );
  }

  if (loadState === "failed" || !view || !draft) {
    return (
      <div className="py-6">
        <p className="text-destructive text-sm" role="alert">
          {t("extensions.imageUnderstanding.settings.errors.loadFailed")}
        </p>
        <Button type="button" variant="outline" className="mt-3 rounded-full" onClick={load}>
          {t("extensions.imageUnderstanding.settings.retry")}
        </Button>
      </div>
    );
  }

  const dirty = settingsDirty(view, draft);
  const persistedAdapter = ocrAdapterSettingsFromValue(view.value);
  const selectedCredentialConfigured =
    draft.ocrApiKey.length > 0 ||
    (!draft.clearOcrCredential &&
      draft.ocrAdapterSource === persistedAdapter.source &&
      persistedAdapter.credentialConfigured);
  const ocrAdapterDisabled =
    saving ||
    !adapterProtocolAvailable ||
    draft.routing === "native-only" ||
    draft.routing === "disabled";
  let parsedAdapter: ReturnType<typeof parseOcrAdapterSource> | undefined;
  try {
    parsedAdapter = parseOcrAdapterSource(draft.ocrAdapterSource);
  } catch {
    parsedAdapter = undefined;
  }
  const credentialWebsite = ocrCredentialWebsiteForPreset(draft.ocrAdapterPreset);

  return (
    <div data-settings-section={sectionId} data-settings-item={itemId} className="py-5">
      <section className="divide-y rounded-xl border px-4">
        <SettingsRow
          title={t("extensions.imageUnderstanding.settings.routing.label")}
          description={t("extensions.imageUnderstanding.settings.routing.description")}
        >
          <ChoiceControl
            label={t("extensions.imageUnderstanding.settings.routing.label")}
            value={draft.routing}
            options={routingOptions}
            disabled={saving}
            onChange={(routing) => updateDraft({ routing })}
          />
        </SettingsRow>
        <SettingsRow
          title={t("extensions.imageUnderstanding.settings.engine.label")}
          description={t("extensions.imageUnderstanding.settings.engine.description")}
        >
          <ChoiceControl
            label={t("extensions.imageUnderstanding.settings.engine.label")}
            value={draft.engine}
            options={engineOptions}
            disabled={saving || draft.routing === "native-only" || draft.routing === "disabled"}
            onChange={(engine) => updateDraft({ engine })}
          />
        </SettingsRow>
        {draft.engine === "ocr" ? (
          <SettingsRow
            title={t("extensions.imageUnderstanding.settings.ocrAdapter.label")}
            description={t("extensions.imageUnderstanding.settings.ocrAdapter.description")}
          >
            <ChoiceControl
              label={t("extensions.imageUnderstanding.settings.ocrAdapter.label")}
              value={draft.ocrAdapterPreset}
              options={ocrAdapterOptions}
              disabled={ocrAdapterDisabled}
              onChange={(ocrAdapterPreset) => {
                if (ocrAdapterPreset === "custom") {
                  updateDraft({ ocrAdapterPreset });
                  return;
                }
                const preset = getOcrAdapterPreset(ocrAdapterPreset);
                updateDraft({
                  ocrAdapterPreset,
                  ocrAdapterSource: preset.source,
                  ocrEndpoint: preset.endpoint,
                  ocrModel: preset.model,
                  ocrApiKey: "",
                  clearOcrCredential: false,
                  ocrPollIntervalMs: String(preset.pollIntervalMs),
                  ocrPollTimeoutMs: String(preset.pollTimeoutMs),
                });
              }}
            />
          </SettingsRow>
        ) : null}
      </section>

      {draft.engine === "ocr" ? (
        <section className="bg-muted/20 mt-5 rounded-xl border p-4">
          <div>
            <h3 className="text-sm font-medium">
              {t("extensions.imageUnderstanding.settings.ocrAdapter.title")}
            </h3>
            <p className="text-muted-foreground mt-1 text-xs leading-5">
              {t("extensions.imageUnderstanding.settings.ocrAdapter.sourceDescription")}
            </p>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              id="attachment-ocr-adapter-endpoint"
              label={t("extensions.imageUnderstanding.settings.providers.endpoint")}
            >
              <Input
                id="attachment-ocr-adapter-endpoint"
                type="url"
                value={draft.ocrEndpoint}
                disabled={ocrAdapterDisabled}
                spellCheck={false}
                autoComplete="url"
                onChange={(event) => updateDraft({ ocrEndpoint: event.currentTarget.value })}
              />
            </Field>
            <Field
              id="attachment-ocr-adapter-model"
              label={t("extensions.imageUnderstanding.settings.providers.model")}
            >
              <Input
                id="attachment-ocr-adapter-model"
                value={draft.ocrModel}
                disabled={ocrAdapterDisabled}
                spellCheck={false}
                onChange={(event) => updateDraft({ ocrModel: event.currentTarget.value })}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field
                id="attachment-ocr-adapter-api-key"
                label={t("extensions.imageUnderstanding.settings.providers.apiKey")}
                labelAction={
                  credentialWebsite ? (
                    <a
                      href={credentialWebsite.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary inline-flex items-center gap-1 text-xs font-medium underline underline-offset-4"
                    >
                      {t("extensions.imageUnderstanding.settings.providers.openCredentialWebsite", {
                        provider: credentialWebsite.provider,
                      })}
                      <ExternalLinkIcon aria-hidden="true" className="size-3 shrink-0" />
                    </a>
                  ) : null
                }
                description={
                  selectedCredentialConfigured
                    ? t("extensions.imageUnderstanding.settings.providers.credentialConfigured")
                    : t("extensions.imageUnderstanding.settings.providers.credentialNotConfigured")
                }
              >
                <div className="flex gap-2">
                  <Input
                    id="attachment-ocr-adapter-api-key"
                    aria-describedby="attachment-ocr-adapter-api-key-description"
                    type="password"
                    value={draft.ocrApiKey}
                    disabled={ocrAdapterDisabled}
                    autoComplete="new-password"
                    placeholder={t(
                      "extensions.imageUnderstanding.settings.providers.apiKeyPlaceholder",
                    )}
                    onChange={(event) =>
                      updateDraft({
                        ocrApiKey: event.currentTarget.value,
                        clearOcrCredential: false,
                      })
                    }
                  />
                  {selectedCredentialConfigured ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={ocrAdapterDisabled}
                      onClick={() => updateDraft({ ocrApiKey: "", clearOcrCredential: true })}
                    >
                      {t("extensions.imageUnderstanding.settings.providers.clearCredential")}
                    </Button>
                  ) : null}
                </div>
              </Field>
            </div>
            <div className="sm:col-span-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                id="attachment-ocr-adapter-poll-interval"
                label={t("extensions.imageUnderstanding.settings.providers.pollInterval")}
              >
                <Input
                  id="attachment-ocr-adapter-poll-interval"
                  type="number"
                  min={100}
                  value={draft.ocrPollIntervalMs}
                  disabled={ocrAdapterDisabled}
                  onChange={(event) =>
                    updateDraft({ ocrPollIntervalMs: event.currentTarget.value })
                  }
                />
              </Field>
              <Field
                id="attachment-ocr-adapter-poll-timeout"
                label={t("extensions.imageUnderstanding.settings.providers.pollTimeout")}
              >
                <Input
                  id="attachment-ocr-adapter-poll-timeout"
                  type="number"
                  min={1000}
                  value={draft.ocrPollTimeoutMs}
                  disabled={ocrAdapterDisabled}
                  onChange={(event) => updateDraft({ ocrPollTimeoutMs: event.currentTarget.value })}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field
                id="attachment-ocr-adapter-source"
                label={t("extensions.imageUnderstanding.settings.ocrAdapter.sourceLabel")}
                description={t("extensions.imageUnderstanding.settings.ocrAdapter.sourceSecurity")}
              >
                <WorkbenchCodeEditor
                  id="attachment-ocr-adapter-source"
                  ariaLabel={t("extensions.imageUnderstanding.settings.ocrAdapter.sourceLabel")}
                  exitLabel={t("extensions.imageUnderstanding.settings.ocrAdapter.exitEditor")}
                  saveLabel={t("extensions.imageUnderstanding.settings.ocrAdapter.saveShortcut")}
                  name="ocr-adapter.ts"
                  value={draft.ocrAdapterSource}
                  disabled={ocrAdapterDisabled}
                  className="bg-background focus-within:border-ring h-96 min-h-64 max-h-[36rem] resize-y rounded-lg border"
                  onSave={save}
                  onChange={(source) => {
                    const matchingPreset = OCR_ADAPTER_PRESETS.find(
                      (preset) => preset.source === source,
                    );
                    updateDraft({
                      ocrAdapterSource: source,
                      ocrAdapterPreset: matchingPreset?.id ?? "custom",
                    });
                  }}
                />
              </Field>
              {parsedAdapter ? (
                <p className="text-muted-foreground mt-2 text-xs leading-5" role="status">
                  {t("extensions.imageUnderstanding.settings.ocrAdapter.validSummary", {
                    id: parsedAdapter.id,
                    operation:
                      parsedAdapter.operation.kind === "sync"
                        ? t("extensions.imageUnderstanding.settings.ocrAdapter.operations.sync")
                        : t("extensions.imageUnderstanding.settings.ocrAdapter.operations.async"),
                    kinds: parsedAdapter.accepts
                      .map((kind) =>
                        kind === "pdf"
                          ? t("extensions.imageUnderstanding.settings.ocrAdapter.kinds.pdf")
                          : t("extensions.imageUnderstanding.settings.ocrAdapter.kinds.image"),
                      )
                      .join(" / "),
                  })}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <section className="bg-muted/20 mt-5 rounded-xl border p-4">
          <h3 className="text-sm font-medium">
            {t("extensions.imageUnderstanding.settings.multimodal.title")}
          </h3>
          <p className="text-muted-foreground mt-1 text-xs leading-5">
            {t("extensions.imageUnderstanding.settings.multimodal.description")}
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              id="image-multimodal-provider"
              label={t("extensions.imageUnderstanding.settings.multimodal.provider")}
            >
              <ChoiceControl
                id="image-multimodal-provider"
                label={t("extensions.imageUnderstanding.settings.multimodal.provider")}
                value={draft.multimodalProvider}
                options={multimodalProviders}
                disabled={saving}
                placeholder={t(
                  "extensions.imageUnderstanding.settings.multimodal.providerPlaceholder",
                )}
                emptyMessage={
                  modelCatalogLoadState === "loading"
                    ? t("extensions.imageUnderstanding.settings.multimodal.loadingModels")
                    : modelCatalogLoadState === "failed"
                      ? t("extensions.imageUnderstanding.settings.multimodal.modelsLoadFailed")
                      : t("extensions.imageUnderstanding.settings.multimodal.noConfiguredProviders")
                }
                emptyAlert={modelCatalogLoadState === "failed"}
                align="start"
                triggerClassName="bg-background h-9 w-full justify-between rounded-lg border"
                contentClassName="max-h-72 overflow-y-auto"
                onOpenChange={(open) => {
                  if (open && modelCatalogLoadState === "failed") loadModelCatalog();
                }}
                onChange={(multimodalProvider) => {
                  const provider = multimodalProviders.find(
                    (candidate) => candidate.value === multimodalProvider,
                  );
                  const currentModelIsAvailable = provider?.models.some(
                    (model) => model.value === draft.multimodalModel,
                  );
                  updateDraft({
                    multimodalProvider,
                    multimodalModel: currentModelIsAvailable
                      ? draft.multimodalModel
                      : (provider?.models[0]?.value ?? ""),
                  });
                }}
              />
            </Field>
            <Field
              id="image-multimodal-model"
              label={t("extensions.imageUnderstanding.settings.providers.model")}
            >
              <ChoiceControl
                id="image-multimodal-model"
                label={t("extensions.imageUnderstanding.settings.providers.model")}
                value={draft.multimodalModel}
                options={selectedMultimodalProvider?.models ?? []}
                disabled={saving}
                placeholder={t(
                  "extensions.imageUnderstanding.settings.multimodal.modelPlaceholder",
                )}
                emptyMessage={t(
                  "extensions.imageUnderstanding.settings.multimodal.selectProviderFirst",
                )}
                align="start"
                triggerClassName="bg-background h-9 w-full justify-between rounded-lg border"
                contentClassName="max-h-72 overflow-y-auto"
                onChange={(multimodalModel) => updateDraft({ multimodalModel })}
              />
            </Field>
          </div>
        </section>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div aria-live="polite" aria-atomic="true">
          {validationError ? (
            <p className="text-destructive text-sm" role="alert">
              {validationError}
            </p>
          ) : saveError ? (
            <p className="text-destructive text-sm" role="alert">
              {saveError}
            </p>
          ) : saved ? (
            <p className="text-muted-foreground text-sm" role="status">
              {t("extensions.imageUnderstanding.settings.saved")}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          className="ms-auto rounded-full"
          disabled={
            saving ||
            !dirty ||
            Boolean(validationError) ||
            (draft.routing !== "disabled" &&
              draft.routing !== "native-only" &&
              draft.engine === "multimodal" &&
              modelCatalogLoadState === "loading")
          }
          onClick={() => void save()}
        >
          {saving
            ? t("extensions.imageUnderstanding.settings.saving")
            : t("extensions.imageUnderstanding.settings.save")}
        </Button>
      </div>
      <p className="text-muted-foreground mt-3 text-xs leading-5">
        {t("extensions.imageUnderstanding.settings.securityNote")}
      </p>
    </div>
  );
}

/** @deprecated Use the attachment-neutral settings component name. */
export const ImageUnderstandingSettingsItem = AttachmentUnderstandingSettingsItem;
