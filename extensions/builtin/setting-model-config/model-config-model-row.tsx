"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon, Trash2Icon } from "lucide-react";

import { collapsePanel } from "@/components/elements/surfaces";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  SettingsDropdownCheckboxItem,
  SettingsDropdownContent,
  SettingsDropdownItem,
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
  SettingsInlineEditor,
} from "@/components/ui/settings-control";
import { Switch } from "@/components/ui/switch";
import { useI18n, type StaticMessageKey } from "@/i18n";
import { verifiedImageInputCapability } from "@/runtime/pi/shared/models/capabilities";
import type { ModelProviderModelConfiguration } from "@/runtime/pi/contracts/rpc";

import {
  DEFAULT_MODEL_CONTEXT_WINDOW,
  modelNameAfterIdChange,
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
} as const satisfies Record<ModelReasoningLevel, StaticMessageKey>;

export interface ModelCatalogRowTestResult {
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
): StaticMessageKey {
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
): StaticMessageKey {
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
  if (!model.reasoning) return [];
  return MODEL_REASONING_LEVELS.filter((level) => model.thinkingLevelMap?.[level] !== null);
}

function setReasoningLevelSupported(
  current: ModelDraft["thinkingLevelMap"],
  level: ModelReasoningLevel,
  supported: boolean,
): ModelDraft["thinkingLevelMap"] {
  const next = { ...current };
  if (supported) delete next[level];
  else next[level] = null;
  return Object.keys(next).length > 0 ? next : undefined;
}

function MaxOutputTokensEditor({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange(value: string): void;
}) {
  const { number, t } = useI18n();
  const [editing, setEditing] = useState(false);
  const editStartValueRef = useRef(value);
  const parsed = value.trim() ? parseCapacity(value) : undefined;
  const invalid = value.trim().length > 0 && parsed === undefined;

  const cancelEditing = () => {
    onChange(editStartValueRef.current);
    setEditing(false);
  };

  return (
    <SettingsInlineEditor
      editing={editing}
      display={
        <span className="text-sm tabular-nums">
          {value.trim()
            ? parsed === undefined
              ? value
              : number(parsed)
            : t("extensions.modelConfig.maxOutputTokensUnset")}
        </span>
      }
      editLabel={t("extensions.modelConfig.editMaxOutputTokens")}
      cancelLabel={t("extensions.modelConfig.cancel")}
      disabled={disabled}
      editingClassName="max-w-64"
      cancelButtonVariant="default"
      onEdit={() => {
        editStartValueRef.current = value;
        setEditing(true);
      }}
      onCancel={cancelEditing}
    >
      <Input
        autoFocus
        inputMode="decimal"
        value={value}
        disabled={disabled}
        aria-label={t("extensions.modelConfig.maxOutputTokens")}
        aria-invalid={invalid}
        placeholder="256K"
        className="min-w-24 tabular-nums"
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancelEditing();
          } else if (event.key === "Enter" && !invalid) {
            event.preventDefault();
            setEditing(false);
          }
        }}
      />
    </SettingsInlineEditor>
  );
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

function LazyCollapsibleContent({ open, children }: { open: boolean; children(): ReactNode }) {
  const retainedChildren = useRef<ReactNode>(null);
  const visibleChildren = open ? children() : retainedChildren.current;

  useLayoutEffect(() => {
    if (open) retainedChildren.current = visibleChildren;
  }, [open, visibleChildren]);

  useEffect(() => {
    if (!open && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      retainedChildren.current = null;
    }
  }, [open]);

  return (
    <CollapsibleContent
      className={`${collapsePanel} outline-none`}
      onTransitionEnd={(event) => {
        if (!open && event.target === event.currentTarget && event.propertyName === "height") {
          retainedChildren.current = null;
        }
      }}
    >
      {visibleChildren}
    </CollapsibleContent>
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
  testResult,
  onUpdateModel,
  onSelectAvailableModel,
  onRefreshAvailableModels,
  onTestModelImageInput,
  onRemoveModel,
}: ModelCatalogRowProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(model.expanded);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  return (
    <div className="[content-visibility:auto] [contain-intrinsic-size:auto_3rem]">
      <Collapsible open={expanded} onOpenChange={setExpanded} className="rounded-lg border p-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(7rem,0.5fr)_auto_auto] gap-1.5">
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
                onChange={(event) => {
                  const id = event.currentTarget.value;
                  onUpdateModel(model.key, {
                    id,
                    name: modelNameAfterIdChange(model, id),
                    ...(id === model.id
                      ? {}
                      : {
                          reasoning: false,
                          thinkingLevelMap: undefined,
                          input: undefined,
                          imageInputSource: undefined,
                        }),
                  });
                }}
              />
              <InputGroupAddon align="inline-end">
                <DropdownMenuTrigger
                  type="button"
                  disabled={busy}
                  aria-label={t("extensions.modelConfig.selectAvailableModel")}
                  className="group text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex size-6 shrink-0 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50"
                >
                  <ChevronDownIcon className="size-3.5 transition-transform group-data-popup-open:rotate-180" />
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
                      (other) => other.key !== model.key && other.id.trim() === availableModel.id,
                    )}
                    onClick={() => onSelectAvailableModel(model.key, availableModel)}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono">{availableModel.id}</span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {t(
                        modelTypeMessageKey(availableModel.input, availableModel.imageInputSource),
                      )}
                    </span>
                  </SettingsDropdownItem>
                ))
              )}
            </SettingsDropdownContent>
          </DropdownMenu>
          <Input
            value={model.name}
            disabled={busy}
            aria-label={t("extensions.modelConfig.modelName")}
            placeholder={t("extensions.modelConfig.modelName")}
            onChange={(event) => onUpdateModel(model.key, { name: event.currentTarget.value })}
            onBlur={() => {
              if (!model.name.trim() && model.id.trim()) {
                onUpdateModel(model.key, { name: model.id.trim() });
              }
            }}
          />
          <Input
            inputMode="numeric"
            pattern="[0-9]*"
            value={normalizeContextWindowInput(model.contextWindow)}
            disabled={busy}
            aria-label={t("extensions.modelConfig.contextWindow")}
            title={t("extensions.modelConfig.contextWindow")}
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
          <CollapsibleTrigger
            type="button"
            disabled={busy}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--button-radius)] bg-transparent p-1.5 outline-none transition-colors focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50"
            aria-label={
              expanded
                ? t("extensions.modelConfig.collapseModel", { name: model.name || model.id })
                : t("extensions.modelConfig.expandModel", { name: model.name || model.id })
            }
          >
            {expanded ? (
              <ChevronDownIcon className="size-4" />
            ) : (
              <ChevronRightIcon className="size-4" />
            )}
          </CollapsibleTrigger>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={busy}
            aria-label={t("extensions.modelConfig.removeModel", {
              name: model.name || model.id,
            })}
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onRemoveModel(model.key)}
          >
            <Trash2Icon />
          </Button>
        </div>
        <LazyCollapsibleContent open={expanded}>
          {() => (
            <>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="flex min-h-14 items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {t("extensions.modelConfig.thinkingModel")}
                    </p>
                  </div>
                  <Switch
                    checked={model.reasoning}
                    disabled={busy}
                    aria-label={t("extensions.modelConfig.thinkingModel")}
                    onCheckedChange={(checked) => onUpdateModel(model.key, { reasoning: checked })}
                  />
                </div>
                <div className="flex min-h-14 items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <span className="min-w-0 text-sm font-medium">
                    {t("extensions.modelConfig.reasoningLevels")}
                  </span>
                  <DropdownMenu>
                    <SettingsDropdownTrigger
                      disabled={busy || !model.reasoning}
                      aria-label={t("extensions.modelConfig.reasoningLevels")}
                    >
                      <span className="min-w-0 truncate text-start">
                        {model.reasoning
                          ? t("extensions.modelConfig.reasoningLevelsSelected", {
                              count: enabledReasoningLevels(model).length,
                            })
                          : t("extensions.modelConfig.reasoningLevelsDisabled")}
                      </span>
                      <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0" />
                    </SettingsDropdownTrigger>
                    <SettingsDropdownContent align="end" side="bottom">
                      {MODEL_REASONING_LEVELS.map((level) => {
                        const enabledLevels = enabledReasoningLevels(model);
                        const checked = enabledLevels.includes(level);
                        return (
                          <SettingsDropdownCheckboxItem
                            key={level}
                            checked={checked}
                            disabled={checked && enabledLevels.length === 1}
                            onCheckedChange={(supported) =>
                              onUpdateModel(model.key, {
                                thinkingLevelMap: setReasoningLevelSupported(
                                  model.thinkingLevelMap,
                                  level,
                                  supported,
                                ),
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
                <div className="flex min-h-14 items-center justify-between gap-3 rounded-md border px-3 py-2">
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
                      disabled={
                        busy || testingDisabled || !providerReadyForTest || !model.id.trim()
                      }
                      aria-label={t("extensions.modelConfig.testMultimodal", {
                        name: model.name || model.id,
                      })}
                      onClick={() => onTestModelImageInput(model)}
                    >
                      {testing
                        ? t("extensions.modelConfig.testingMultimodal")
                        : t("extensions.modelConfig.testMultimodalShort")}
                    </Button>
                  </div>
                </div>
                <div className="flex min-h-14 items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <span className="min-w-0 text-sm font-medium">
                    {t("extensions.modelConfig.maxOutputTokens")}
                  </span>
                  <MaxOutputTokensEditor
                    value={model.maxTokens}
                    disabled={busy}
                    onChange={(maxTokens) => onUpdateModel(model.key, { maxTokens })}
                  />
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
            </>
          )}
        </LazyCollapsibleContent>
      </Collapsible>
      {!model.id.trim() ? (
        <p className="text-muted-foreground mt-1.5 text-sm">
          {t("extensions.modelConfig.modelIdRequired", { index: index + 1 })}
        </p>
      ) : null}
    </div>
  );
}

export const ModelCatalogRow = memo(ModelCatalogRowComponent, modelCatalogRowPropsEqual);
ModelCatalogRow.displayName = "ModelCatalogRow";
