"use client";

import { useModelTestFeedback } from "./use-model-test-feedback";
import { memo, useState } from "react";
import {
  ChevronDownIcon,
  PencilIcon,
  Trash2Icon,
  PlugZapIcon,
  LoaderCircleIcon,
} from "lucide-react";

import { Button, StatusBadge } from "@workbench/shell/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workbench/shell/ui";
import { DropdownMenu, DropdownMenuRadioGroup, DropdownMenuTrigger } from "@workbench/shell/ui";
import { Input } from "@workbench/shell/ui";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@workbench/shell/ui";
import {
  SettingsDropdownCheckboxItem,
  DropdownMenuSeparator,
  SettingsDropdownContent,
  SettingsDropdownItem,
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
  SettingsField,
} from "@workbench/shell/ui";
import { type PiStaticMessageKey, usePiI18n } from "../../i18n";
import {
  supportedModelThinkingLevels,
  verifiedImageInputCapability,
} from "@workbench/agent-runtime-pi-shared/models";
import type { ModelProviderModelConfiguration } from "@workbench/agent-runtime-pi-protocol/rpc";

import {
  DEFAULT_MODEL_CONTEXT_WINDOW,
  formatCapacity,
  normalizeContextWindowInput,
  parseCapacity,
  type ModelDraft,
} from "./model-config-draft";

type ModelTypeValue = "multimodal" | "text";
const MODEL_REASONING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ModelReasoningLevel = (typeof MODEL_REASONING_LEVELS)[number];
const MODEL_REASONING_LEVEL_MESSAGE_KEYS = {
  minimal: "extensions.modelConfig.reasoningLevelMinimal",
  low: "extensions.modelConfig.reasoningLevelLow",
  medium: "extensions.modelConfig.reasoningLevelMedium",
  high: "extensions.modelConfig.reasoningLevelHigh",
  xhigh: "extensions.modelConfig.reasoningLevelXhigh",
  max: "extensions.modelConfig.reasoningLevelMax",
} as const satisfies Record<ModelReasoningLevel, PiStaticMessageKey>;

export interface ModelCatalogRowTestResult {
  connection?: "connected" | "image-supported";
  showConnectionWarning?: boolean;
  kind: "success" | "warning" | "error";
  message: string;
}

interface ModelCatalogRowProps {
  model: ModelDraft;
  index: number;
  configuredModels: readonly ModelDraft[];
  availableModels: readonly ModelProviderModelConfiguration[];
  busy: boolean;
  modelPickerLoading: boolean;
  modelPickerError?: string;
  providerReadyForTest: boolean;
  testingDisabled: boolean;
  testing: boolean;
  testResult?: ModelCatalogRowTestResult;
  onUpdateModel(key: number, patch: Partial<ModelDraft>): void;
  onSelectAvailableModel(key: number, model: ModelProviderModelConfiguration): void;
  onRefreshAvailableModels(): void;
  onTestModelImageInput(model: ModelDraft): void;
  onRemoveModel(key: number): void;
  onComplete?: () => void;
  completionError?: string;
}

function modelTypeValue(
  input: ModelDraft["input"],
  source: ModelDraft["imageInputSource"],
): ModelTypeValue | undefined {
  switch (verifiedImageInputCapability(input, source)) {
    case "supported":
      return "multimodal";
    case "unsupported":
      return "text";
    case "unknown":
      return undefined;
  }
}

export function modelTypeMessageKey(
  input: ModelDraft["input"],
  source: ModelDraft["imageInputSource"],
): PiStaticMessageKey {
  switch (modelTypeValue(input, source)) {
    case "multimodal":
      return "extensions.modelConfig.modelTypeMultimodal";
    case "text":
      return "extensions.modelConfig.modelTypeText";
    case undefined:
      return "extensions.modelConfig.modelTypeUnknown";
  }
}

function multimodalSupportMessageKey(
  input: ModelDraft["input"],
  source: ModelDraft["imageInputSource"],
): PiStaticMessageKey {
  switch (modelTypeValue(input, source)) {
    case "multimodal":
      return "extensions.modelConfig.multimodalSupported";
    case "text":
      return "extensions.modelConfig.multimodalUnsupported";
    case undefined:
      return "extensions.modelConfig.modelTypeUnknown";
  }
}

function enabledReasoningLevels(model: ModelDraft): ModelReasoningLevel[] {
  return supportedModelThinkingLevels(model).filter((level) => level !== "off");
}

export function setReasoningLevelSupported(
  model: Pick<ModelDraft, "reasoning" | "thinkingLevelMap">,
  level: ModelReasoningLevel,
  supported: boolean,
): ModelDraft["thinkingLevelMap"] {
  const next: NonNullable<ModelDraft["thinkingLevelMap"]> = model.reasoning
    ? { ...model.thinkingLevelMap }
    : {
        ...model.thinkingLevelMap,
        ...Object.fromEntries(MODEL_REASONING_LEVELS.map((level) => [level, null])),
      };
  const mapped = model.thinkingLevelMap?.[level];
  if (!supported) next[level] = null;
  else if (typeof mapped === "string") next[level] = mapped;
  else if (level === "xhigh" || level === "max") next[level] = level;
  else delete next[level];
  return Object.keys(next).length > 0 ? next : undefined;
}

function sameConfiguredModelIds(
  left: readonly ModelDraft[],
  right: readonly ModelDraft[],
): boolean {
  return (
    left === right ||
    (left.length === right.length &&
      left.every(
        (model, index) =>
          model.key === right[index]?.key && model.id.trim() === right[index]?.id.trim(),
      ))
  );
}

function modelCatalogRowPropsEqual(
  previous: Readonly<ModelCatalogRowProps>,
  next: Readonly<ModelCatalogRowProps>,
): boolean {
  return (
    previous.onComplete === next.onComplete &&
    previous.completionError === next.completionError &&
    previous.model === next.model &&
    previous.index === next.index &&
    previous.availableModels === next.availableModels &&
    sameConfiguredModelIds(previous.configuredModels, next.configuredModels) &&
    previous.busy === next.busy &&
    previous.modelPickerLoading === next.modelPickerLoading &&
    previous.modelPickerError === next.modelPickerError &&
    previous.providerReadyForTest === next.providerReadyForTest &&
    previous.testingDisabled === next.testingDisabled &&
    previous.testing === next.testing &&
    previous.testResult === next.testResult &&
    previous.onUpdateModel === next.onUpdateModel &&
    previous.onSelectAvailableModel === next.onSelectAvailableModel &&
    previous.onRefreshAvailableModels === next.onRefreshAvailableModels &&
    previous.onTestModelImageInput === next.onTestModelImageInput &&
    previous.onRemoveModel === next.onRemoveModel
  );
}

function ModelCatalogRowComponent({
  model,
  index,
  configuredModels,
  availableModels,
  busy,
  modelPickerLoading,
  modelPickerError,
  providerReadyForTest,
  testingDisabled,
  testing,
  testResult: storedTestResult,
  onUpdateModel,
  onSelectAvailableModel,
  onRefreshAvailableModels,
  onTestModelImageInput,
  onRemoveModel,
  onComplete,
  completionError,
}: ModelCatalogRowProps) {
  const { t } = usePiI18n();
  const testResult = useModelTestFeedback(storedTestResult);
  const [editorOpen, setEditorOpen] = useState(
    Boolean(onComplete) || model.expanded || !model.id.trim(),
  );
  const contextWindow = parseCapacity(model.contextWindow);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  const updateModelId = (id: string) =>
    onUpdateModel(model.key, {
      id,
      name: id,
      ...(id === model.id
        ? {}
        : {
            reasoning: false,
            thinkingLevelMap: undefined,
            input: undefined,
            imageInputSource: undefined,
          }),
    });

  return (
    <div
      className={
        onComplete
          ? "contents"
          : "rounded-[var(--button-radius)] border bg-background p-2 [content-visibility:auto] [contain-intrinsic-size:auto_3rem]"
      }
    >
      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          if (!open && onComplete) onRemoveModel(model.key);
          setEditorOpen(open);
        }}
      >
        {!onComplete ? (
          <div className="flex min-w-0 items-center gap-2">
            <InputGroup className="min-w-0 flex-1">
              <InputGroupInput
                value={model.id}
                disabled={busy}
                aria-label={t("extensions.modelConfig.modelId")}
                placeholder={t("extensions.modelConfig.modelId")}
                className="font-mono"
                onChange={(event) => updateModelId(event.currentTarget.value)}
              />
              {contextWindow ? (
                <InputGroupAddon align="inline-end">
                  <span
                    className="rounded-[var(--button-radius)] border border-border px-1.5 text-xs tabular-nums text-muted-foreground"
                    aria-label={t("extensions.modelConfig.contextSummary", {
                      capacity: formatCapacity(contextWindow),
                    })}
                  >
                    {formatCapacity(contextWindow)}
                  </span>
                </InputGroupAddon>
              ) : null}
            </InputGroup>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={busy || testingDisabled || !providerReadyForTest || !model.id.trim()}
              aria-label={t("extensions.modelConfig.testMultimodal", { name: model.id })}
              onClick={() => onTestModelImageInput(model)}
              className="text-muted-foreground"
            >
              {testing ? (
                <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
              ) : (
                <PlugZapIcon />
              )}
            </Button>
            <DialogTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy}
                  className="text-muted-foreground"
                />
              }
              aria-label={t("extensions.modelConfig.editModel", {
                name: model.id || t("extensions.modelConfig.newModel"),
              })}
            >
              <PencilIcon />
            </DialogTrigger>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={busy}
              aria-label={t("extensions.modelConfig.removeModel", {
                name: model.id || t("extensions.modelConfig.newModel"),
              })}
              onClick={() => onRemoveModel(model.key)}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2Icon />
            </Button>
          </div>
        ) : null}
        <DialogContent
          aria-describedby={undefined}
          closeLabel={t(
            onComplete ? "extensions.modelConfig.cancel" : "extensions.modelConfig.done",
          )}
          className="@container/model max-h-[85dvh] overflow-y-auto sm:max-w-2xl"
        >
          <DialogHeader>
            <DialogTitle>
              {t("extensions.modelConfig.editModel", {
                name: model.id || t("extensions.modelConfig.newModel"),
              })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="grid min-w-0 gap-4">
              <SettingsField label={t("extensions.modelConfig.modelId")}>
                <DropdownMenu
                  onOpenChange={(open) => {
                    setModelMenuOpen(open);
                    if (open && availableModels.length === 0 && !modelPickerLoading) {
                      onRefreshAvailableModels();
                    }
                  }}
                >
                  <InputGroup className="h-[var(--dropdown-control-height)]">
                    <InputGroupInput
                      className="h-full"
                      value={model.id}
                      disabled={busy}
                      aria-label={t("extensions.modelConfig.modelId")}
                      placeholder={t("extensions.modelConfig.modelId")}
                      onChange={(event) => updateModelId(event.currentTarget.value)}
                    />
                    <InputGroupAddon align="inline-end">
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={busy}
                            aria-label={t("extensions.modelConfig.selectAvailableModel")}
                            className="group text-muted-foreground"
                          />
                        }
                      >
                        <ChevronDownIcon className="transition-transform group-data-popup-open:rotate-180" />
                      </DropdownMenuTrigger>
                    </InputGroupAddon>
                  </InputGroup>
                  <SettingsDropdownContent align="end" side="bottom" className="max-h-72 min-w-64">
                    {!modelMenuOpen ? null : modelPickerLoading ? (
                      <div className="text-muted-foreground px-2.5 py-2 text-sm" role="status">
                        {t("extensions.modelConfig.fetchingAvailableModels")}
                      </div>
                    ) : modelPickerError ? (
                      <div className="text-destructive px-2.5 py-2 text-sm" role="alert">
                        {modelPickerError}
                      </div>
                    ) : availableModels.length === 0 ? (
                      <div className="text-muted-foreground px-2.5 py-2 text-sm">
                        {t("extensions.modelConfig.availableModelsEmpty")}
                      </div>
                    ) : (
                      availableModels.map((availableModel) => (
                        <SettingsDropdownItem
                          key={availableModel.id}
                          disabled={configuredModels.some(
                            (other) =>
                              other.key !== model.key && other.id.trim() === availableModel.id,
                          )}
                          onClick={() => onSelectAvailableModel(model.key, availableModel)}
                        >
                          <span className="min-w-0 flex-1 truncate font-mono">
                            {availableModel.id}
                          </span>
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {t(
                              modelTypeMessageKey(
                                availableModel.input,
                                availableModel.imageInputSource,
                              ),
                            )}
                          </span>
                        </SettingsDropdownItem>
                      ))
                    )}
                  </SettingsDropdownContent>
                </DropdownMenu>
              </SettingsField>
              <SettingsField label={t("extensions.modelConfig.contextWindow")}>
                <Input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={normalizeContextWindowInput(model.contextWindow)}
                  disabled={busy}
                  aria-label={t("extensions.modelConfig.contextWindow")}
                  placeholder={t("extensions.modelConfig.contextWindow")}
                  onChange={(event) =>
                    onUpdateModel(model.key, {
                      contextWindow: event.currentTarget.value.replace(/\D+/gu, ""),
                    })
                  }
                  onBlur={() => {
                    if (!model.contextWindow.trim()) {
                      onUpdateModel(model.key, {
                        contextWindow: String(DEFAULT_MODEL_CONTEXT_WINDOW),
                      });
                    }
                  }}
                />
              </SettingsField>
              <SettingsField label={t("extensions.modelConfig.maxOutputTokens")}>
                <Input
                  value={model.maxTokens}
                  disabled={busy}
                  inputMode="decimal"
                  aria-label={t("extensions.modelConfig.maxOutputTokens")}
                  aria-invalid={
                    model.maxTokens.trim().length > 0 &&
                    parseCapacity(model.maxTokens) === undefined
                  }
                  placeholder={t("extensions.modelConfig.maxOutputTokensUnset")}
                  onChange={(event) =>
                    onUpdateModel(model.key, { maxTokens: event.currentTarget.value })
                  }
                />
              </SettingsField>
            </div>
            <div className="space-y-5">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <span className="shrink-0 text-sm font-medium">
                  {t("extensions.modelConfig.reasoningLevels")}
                </span>
                <DropdownMenu>
                  <SettingsDropdownTrigger
                    disabled={busy}
                    aria-label={t("extensions.modelConfig.reasoningLevels")}
                  >
                    <span>
                      {model.reasoning
                        ? t("extensions.modelConfig.reasoningLevelsSelected", {
                            count: enabledReasoningLevels(model).length,
                          })
                        : t("extensions.modelConfig.reasoningOff")}
                    </span>
                    <ChevronDownIcon className="text-muted-foreground" />
                  </SettingsDropdownTrigger>
                  <SettingsDropdownContent align="end" className="w-60">
                    <DropdownMenuRadioGroup
                      value={model.reasoning ? "" : "off"}
                      onValueChange={() => onUpdateModel(model.key, { reasoning: false })}
                    >
                      <SettingsDropdownRadioItem value="off">
                        {t("extensions.modelConfig.reasoningOff")}
                      </SettingsDropdownRadioItem>
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSeparator />
                    {MODEL_REASONING_LEVELS.map((level) => {
                      const enabled = enabledReasoningLevels(model);
                      const supported = enabled.includes(level);
                      return (
                        <SettingsDropdownCheckboxItem
                          key={level}
                          checked={supported}
                          closeOnClick={false}
                          className="data-checked:text-muted-foreground"
                          disabled={supported && enabled.length === 1}
                          onCheckedChange={(checked) =>
                            onUpdateModel(model.key, {
                              reasoning: true,
                              thinkingLevelMap: setReasoningLevelSupported(model, level, checked),
                            })
                          }
                        >
                          {t(MODEL_REASONING_LEVEL_MESSAGE_KEYS[level])}
                        </SettingsDropdownCheckboxItem>
                      );
                    })}
                  </SettingsDropdownContent>
                </DropdownMenu>
              </div>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                <span className="min-w-0 text-sm font-medium">
                  {t("extensions.modelConfig.multimodalSupport")}
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <DropdownMenu>
                    <SettingsDropdownTrigger
                      disabled={busy || testingDisabled}
                      aria-label={t("extensions.modelConfig.multimodalSupport")}
                    >
                      <span className="min-w-0 truncate text-start">
                        {t(multimodalSupportMessageKey(model.input, model.imageInputSource))}
                      </span>
                      <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0" />
                    </SettingsDropdownTrigger>
                    <SettingsDropdownContent align="end" side="bottom">
                      <DropdownMenuRadioGroup
                        value={modelTypeValue(model.input, model.imageInputSource) ?? ""}
                        aria-label={t("extensions.modelConfig.multimodalSupport")}
                        onValueChange={(modelType) => {
                          if (modelType === "multimodal") {
                            onUpdateModel(model.key, {
                              input: ["text", "image"],
                              imageInputSource: "user",
                            });
                          } else if (modelType === "text") {
                            onUpdateModel(model.key, {
                              input: ["text"],
                              imageInputSource: "user",
                            });
                          }
                        }}
                      >
                        <SettingsDropdownRadioItem value="multimodal">
                          {t("extensions.modelConfig.multimodalSupported")}
                        </SettingsDropdownRadioItem>
                        <SettingsDropdownRadioItem value="text">
                          {t("extensions.modelConfig.multimodalUnsupported")}
                        </SettingsDropdownRadioItem>
                      </DropdownMenuRadioGroup>
                    </SettingsDropdownContent>
                  </DropdownMenu>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || testingDisabled || !providerReadyForTest || !model.id.trim()}
                    aria-label={t("extensions.modelConfig.testMultimodal", {
                      name: model.id,
                    })}
                    onClick={() => onTestModelImageInput(model)}
                  >
                    {testing
                      ? t("extensions.modelConfig.testingMultimodal")
                      : t("extensions.modelConfig.testMultimodalShort")}
                  </Button>
                </div>
              </div>
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              {t("extensions.modelConfig.multimodalTestHint")}
            </p>
            {testResult ? (
              <p
                className={
                  testResult.kind === "error"
                    ? "text-destructive mt-1.5 text-sm"
                    : testResult.kind === "warning"
                      ? "mt-1.5 text-sm text-amber-700 dark:text-amber-300"
                      : "mt-1.5 text-sm text-emerald-700 dark:text-emerald-300"
                }
                role={testResult.kind === "error" ? "alert" : "status"}
              >
                {testResult.message}
              </p>
            ) : null}
            {!model.id.trim() ? (
              <p className="text-muted-foreground mt-1.5 text-sm">
                {t("extensions.modelConfig.modelIdRequired", { index: index + 1 })}
              </p>
            ) : null}
            {completionError ? (
              <p role="alert" className="text-destructive text-sm">
                {completionError}
              </p>
            ) : null}
            <div className="flex justify-between gap-3 border-t pt-3">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                aria-label={
                  onComplete
                    ? t("extensions.modelConfig.cancel")
                    : t("extensions.modelConfig.removeModel", {
                        name: model.id || t("extensions.modelConfig.newModel"),
                      })
                }
                className={onComplete ? undefined : "text-destructive hover:text-destructive"}
                onClick={() => onRemoveModel(model.key)}
              >
                {!onComplete ? <Trash2Icon /> : null}
                {t(onComplete ? "extensions.modelConfig.cancel" : "extensions.modelConfig.remove")}
              </Button>
              <Button
                type="button"
                disabled={busy || (Boolean(onComplete) && !model.id.trim())}
                onClick={() => (onComplete ? onComplete() : setEditorOpen(false))}
              >
                {t(onComplete ? "extensions.modelConfig.save" : "extensions.modelConfig.done")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {(testing || testResult) && !editorOpen ? (
        <div
          className="mt-2 flex flex-wrap items-center gap-2"
          role={testResult?.kind === "error" ? "alert" : "status"}
        >
          <StatusBadge
            tone={
              testing
                ? "info"
                : testResult?.connection
                  ? "success"
                  : testResult?.kind === "error"
                    ? "danger"
                    : testResult?.kind
            }
            className="rounded-[var(--button-radius)] px-2 py-1 text-sm leading-5"
          >
            {testing
              ? t("extensions.modelConfig.testingMultimodal")
              : testResult?.connection
                ? t(
                    testResult.connection === "image-supported"
                      ? "extensions.modelConfig.connectionSucceededWithImages"
                      : "extensions.modelConfig.connectionSucceeded",
                  )
                : testResult?.message}
          </StatusBadge>
          {!testing && testResult?.connection && testResult.showConnectionWarning ? (
            <StatusBadge
              tone="warning"
              className="rounded-[var(--button-radius)] px-2 py-1 text-sm leading-5"
            >
              {testResult.message}
            </StatusBadge>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const ModelCatalogRow = memo(ModelCatalogRowComponent, modelCatalogRowPropsEqual);
ModelCatalogRow.displayName = "ModelCatalogRow";
