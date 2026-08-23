"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";

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
  describeImageUnderstandingSettings,
  PiApiError,
  updateImageUnderstandingSettings,
} from "@/runtime/pi/client/transport/api";
import type {
  ImageUnderstandingDescribeValue,
  ImageUnderstandingEngine,
  ImageUnderstandingOcrProvider,
  ImageUnderstandingRouting,
  ImageUnderstandingSettingsValue,
} from "@/runtime/pi/rpc-contracts";

type LoadState = "loading" | "ready" | "failed";

interface SettingsDraft {
  routing: ImageUnderstandingRouting;
  engine: ImageUnderstandingEngine;
  ocrProvider: ImageUnderstandingOcrProvider;
  glmEndpoint: string;
  glmModel: string;
  glmApiKey: string;
  clearGlmCredential: boolean;
  paddleEndpoint: string;
  paddleModel: string;
  paddleApiKey: string;
  clearPaddleCredential: boolean;
  paddlePollIntervalMs: string;
  paddlePollTimeoutMs: string;
  multimodalProvider: string;
  multimodalModel: string;
}

interface ChoiceOption<TValue extends string> {
  readonly value: TValue;
  readonly label: string;
}

function draftFromValue(value: ImageUnderstandingSettingsValue): SettingsDraft {
  return {
    routing: value.routing,
    engine: value.engine,
    ocrProvider: value.ocrProvider,
    glmEndpoint: value.glm.endpoint,
    glmModel: value.glm.model,
    glmApiKey: "",
    clearGlmCredential: false,
    paddleEndpoint: value.paddle.endpoint,
    paddleModel: value.paddle.model,
    paddleApiKey: "",
    clearPaddleCredential: false,
    paddlePollIntervalMs: String(value.paddle.pollIntervalMs),
    paddlePollTimeoutMs: String(value.paddle.pollTimeoutMs),
    multimodalProvider: value.multimodal.provider,
    multimodalModel: value.multimodal.model,
  };
}

function settingsDirty(view: ImageUnderstandingDescribeValue, draft: SettingsDraft): boolean {
  const value = view.value;
  return (
    draft.routing !== value.routing ||
    draft.engine !== value.engine ||
    draft.ocrProvider !== value.ocrProvider ||
    draft.glmEndpoint !== value.glm.endpoint ||
    draft.glmModel !== value.glm.model ||
    draft.glmApiKey.length > 0 ||
    draft.clearGlmCredential ||
    draft.paddleEndpoint !== value.paddle.endpoint ||
    draft.paddleModel !== value.paddle.model ||
    draft.paddleApiKey.length > 0 ||
    draft.clearPaddleCredential ||
    draft.paddlePollIntervalMs !== String(value.paddle.pollIntervalMs) ||
    draft.paddlePollTimeoutMs !== String(value.paddle.pollTimeoutMs) ||
    draft.multimodalProvider !== value.multimodal.provider ||
    draft.multimodalModel !== value.multimodal.model
  );
}

function isHttpsEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function parsePositiveInteger(value: string): number | undefined {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function ChoiceControl<TValue extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: TValue;
  options: readonly ChoiceOption<TValue>[];
  disabled?: boolean;
  onChange(value: TValue): void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <SettingsDropdownTrigger aria-label={label} disabled={disabled}>
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDownIcon aria-hidden="true" className="size-3.5" />
      </SettingsDropdownTrigger>
      <SettingsDropdownContent align="end" side="bottom">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const option = options.find(({ value: candidate }) => candidate === next);
            if (option) onChange(option.value);
          }}
        >
          {options.map((option) => (
            <SettingsDropdownRadioItem key={option.value} value={option.value}>
              {option.label}
            </SettingsDropdownRadioItem>
          ))}
        </DropdownMenuRadioGroup>
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
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
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
  description,
  children,
}: {
  id: string;
  label: string;
  description?: string;
  children: ReactNode;
}) {
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {description ? (
        <p id={descriptionId} className="text-muted-foreground mt-1 text-xs leading-5">
          {description}
        </p>
      ) : null}
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function ImageUnderstandingSettingsItem({ sectionId, itemId }: SettingsItemComponentProps) {
  const { t } = useI18n();
  const [view, setView] = useState<ImageUnderstandingDescribeValue>();
  const [draft, setDraft] = useState<SettingsDraft>();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const requestRef = useRef(0);

  const load = useCallback(() => {
    const request = ++requestRef.current;
    setLoadState("loading");
    setSaveError(undefined);
    void describeImageUnderstandingSettings().then(
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

  const updateDraft = useCallback((patch: Partial<SettingsDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setSaved(false);
    setSaveError(undefined);
  }, []);

  const routingOptions = useMemo<readonly ChoiceOption<ImageUnderstandingRouting>[]>(
    () => [
      {
        value: "auto",
        label: t("extensions.imageUnderstanding.settings.routing.options.auto"),
      },
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
  const engineOptions = useMemo<readonly ChoiceOption<ImageUnderstandingEngine>[]>(
    () => [
      { value: "ocr", label: t("extensions.imageUnderstanding.settings.engine.options.ocr") },
      {
        value: "multimodal",
        label: t("extensions.imageUnderstanding.settings.engine.options.multimodal"),
      },
    ],
    [t],
  );
  const ocrProviderOptions = useMemo<readonly ChoiceOption<ImageUnderstandingOcrProvider>[]>(
    () => [
      {
        value: "glm-ocr",
        label: t("extensions.imageUnderstanding.settings.ocrProvider.options.glm"),
      },
      {
        value: "paddleocr",
        label: t("extensions.imageUnderstanding.settings.ocrProvider.options.paddle"),
      },
    ],
    [t],
  );

  const validationError = useMemo(() => {
    if (!draft) return undefined;
    if (
      !draft.glmEndpoint.trim() ||
      !draft.glmModel.trim() ||
      !draft.paddleEndpoint.trim() ||
      !draft.paddleModel.trim()
    ) {
      return t("extensions.imageUnderstanding.settings.errors.requiredFields");
    }
    if (!isHttpsEndpoint(draft.glmEndpoint) || !isHttpsEndpoint(draft.paddleEndpoint)) {
      return t("extensions.imageUnderstanding.settings.errors.invalidEndpoint");
    }
    if (
      !parsePositiveInteger(draft.paddlePollIntervalMs) ||
      !parsePositiveInteger(draft.paddlePollTimeoutMs)
    ) {
      return t("extensions.imageUnderstanding.settings.errors.invalidPolling");
    }
    if (draft.routing === "disabled" || draft.routing === "native-only") return undefined;
    if (draft.engine === "multimodal") {
      return draft.multimodalProvider.trim() && draft.multimodalModel.trim()
        ? undefined
        : t("extensions.imageUnderstanding.settings.errors.requiredFields");
    }
    return undefined;
  }, [draft, t]);

  const save = useCallback(async () => {
    if (!view || !draft || saving || validationError) return;
    const pollIntervalMs = parsePositiveInteger(draft.paddlePollIntervalMs);
    const pollTimeoutMs = parsePositiveInteger(draft.paddlePollTimeoutMs);
    if (!pollIntervalMs || !pollTimeoutMs) return;

    setSaving(true);
    setSaved(false);
    setSaveError(undefined);
    try {
      const updated = await updateImageUnderstandingSettings({
        expectedRevision: view.revision,
        patch: {
          routing: draft.routing,
          engine: draft.engine,
          ocrProvider: draft.ocrProvider,
          glm: {
            endpoint: draft.glmEndpoint.trim(),
            model: draft.glmModel.trim(),
            ...(draft.glmApiKey
              ? { apiKey: draft.glmApiKey }
              : draft.clearGlmCredential
                ? { apiKey: null }
                : {}),
          },
          paddle: {
            endpoint: draft.paddleEndpoint.trim(),
            model: draft.paddleModel.trim(),
            pollIntervalMs,
            pollTimeoutMs,
            ...(draft.paddleApiKey
              ? { apiKey: draft.paddleApiKey }
              : draft.clearPaddleCredential
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
  const selectedCredentialConfigured =
    draft.ocrProvider === "glm-ocr"
      ? draft.glmApiKey.length > 0 ||
        (!draft.clearGlmCredential && view.value.glm.credentialConfigured)
      : draft.paddleApiKey.length > 0 ||
        (!draft.clearPaddleCredential && view.value.paddle.credentialConfigured);
  const providerPrefix = draft.ocrProvider === "glm-ocr" ? "image-glm-ocr" : "image-paddleocr";

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
            title={t("extensions.imageUnderstanding.settings.ocrProvider.label")}
            description={t("extensions.imageUnderstanding.settings.ocrProvider.description")}
          >
            <ChoiceControl
              label={t("extensions.imageUnderstanding.settings.ocrProvider.label")}
              value={draft.ocrProvider}
              options={ocrProviderOptions}
              disabled={saving || draft.routing === "native-only" || draft.routing === "disabled"}
              onChange={(ocrProvider) => updateDraft({ ocrProvider })}
            />
          </SettingsRow>
        ) : null}
      </section>

      {draft.engine === "ocr" ? (
        <section className="bg-muted/20 mt-5 rounded-xl border p-4">
          <div>
            <h3 className="text-sm font-medium">
              {draft.ocrProvider === "glm-ocr"
                ? t("extensions.imageUnderstanding.settings.providers.glmTitle")
                : t("extensions.imageUnderstanding.settings.providers.paddleTitle")}
            </h3>
            <p className="text-muted-foreground mt-1 text-xs leading-5">
              {t("extensions.imageUnderstanding.settings.providers.description")}
            </p>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              id={`${providerPrefix}-endpoint`}
              label={t("extensions.imageUnderstanding.settings.providers.endpoint")}
            >
              <Input
                id={`${providerPrefix}-endpoint`}
                type="url"
                value={draft.ocrProvider === "glm-ocr" ? draft.glmEndpoint : draft.paddleEndpoint}
                disabled={saving}
                spellCheck={false}
                autoComplete="url"
                onChange={(event) =>
                  updateDraft(
                    draft.ocrProvider === "glm-ocr"
                      ? { glmEndpoint: event.currentTarget.value }
                      : { paddleEndpoint: event.currentTarget.value },
                  )
                }
              />
            </Field>
            <Field
              id={`${providerPrefix}-model`}
              label={t("extensions.imageUnderstanding.settings.providers.model")}
            >
              <Input
                id={`${providerPrefix}-model`}
                value={draft.ocrProvider === "glm-ocr" ? draft.glmModel : draft.paddleModel}
                disabled={saving}
                spellCheck={false}
                onChange={(event) =>
                  updateDraft(
                    draft.ocrProvider === "glm-ocr"
                      ? { glmModel: event.currentTarget.value }
                      : { paddleModel: event.currentTarget.value },
                  )
                }
              />
            </Field>
            <Field
              id={`${providerPrefix}-api-key`}
              label={t("extensions.imageUnderstanding.settings.providers.apiKey")}
              description={
                selectedCredentialConfigured
                  ? t("extensions.imageUnderstanding.settings.providers.credentialConfigured")
                  : t("extensions.imageUnderstanding.settings.providers.credentialNotConfigured")
              }
            >
              <div className="flex gap-2">
                <Input
                  id={`${providerPrefix}-api-key`}
                  aria-describedby={`${providerPrefix}-api-key-description`}
                  type="password"
                  value={draft.ocrProvider === "glm-ocr" ? draft.glmApiKey : draft.paddleApiKey}
                  disabled={saving}
                  autoComplete="new-password"
                  placeholder={t(
                    "extensions.imageUnderstanding.settings.providers.apiKeyPlaceholder",
                  )}
                  onChange={(event) =>
                    updateDraft(
                      draft.ocrProvider === "glm-ocr"
                        ? { glmApiKey: event.currentTarget.value, clearGlmCredential: false }
                        : {
                            paddleApiKey: event.currentTarget.value,
                            clearPaddleCredential: false,
                          },
                    )
                  }
                />
                {selectedCredentialConfigured ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={saving}
                    onClick={() =>
                      updateDraft(
                        draft.ocrProvider === "glm-ocr"
                          ? { glmApiKey: "", clearGlmCredential: true }
                          : { paddleApiKey: "", clearPaddleCredential: true },
                      )
                    }
                  >
                    {t("extensions.imageUnderstanding.settings.providers.clearCredential")}
                  </Button>
                ) : null}
              </div>
            </Field>
            {draft.ocrProvider === "paddleocr" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field
                  id="image-paddleocr-poll-interval"
                  label={t("extensions.imageUnderstanding.settings.providers.pollInterval")}
                >
                  <Input
                    id="image-paddleocr-poll-interval"
                    type="number"
                    min={1}
                    value={draft.paddlePollIntervalMs}
                    disabled={saving}
                    onChange={(event) =>
                      updateDraft({ paddlePollIntervalMs: event.currentTarget.value })
                    }
                  />
                </Field>
                <Field
                  id="image-paddleocr-poll-timeout"
                  label={t("extensions.imageUnderstanding.settings.providers.pollTimeout")}
                >
                  <Input
                    id="image-paddleocr-poll-timeout"
                    type="number"
                    min={1}
                    value={draft.paddlePollTimeoutMs}
                    disabled={saving}
                    onChange={(event) =>
                      updateDraft({ paddlePollTimeoutMs: event.currentTarget.value })
                    }
                  />
                </Field>
              </div>
            ) : null}
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
              <Input
                id="image-multimodal-provider"
                value={draft.multimodalProvider}
                disabled={saving}
                spellCheck={false}
                onChange={(event) => updateDraft({ multimodalProvider: event.currentTarget.value })}
              />
            </Field>
            <Field
              id="image-multimodal-model"
              label={t("extensions.imageUnderstanding.settings.providers.model")}
            >
              <Input
                id="image-multimodal-model"
                value={draft.multimodalModel}
                disabled={saving}
                spellCheck={false}
                onChange={(event) => updateDraft({ multimodalModel: event.currentTarget.value })}
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
          disabled={saving || !dirty || Boolean(validationError)}
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
