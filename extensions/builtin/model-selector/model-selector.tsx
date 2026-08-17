"use client";

import {
  ModelSelector as AssistantModelSelector,
  type ModelSelectorEffortOption,
  type ModelOption,
} from "@/components/assistant-ui/model-selector";
import { useI18n } from "@/i18n";
import type { ComposerSlotContext } from "@/platform/extensions";

import { MODEL_OPTIONS, type ReasoningEffort, useModelSelectorStore } from "./model-selector-store";

const REASONING_EFFORTS = new Set<ReasoningEffort>(["low", "medium", "high"]);

export function ModelSelector({ isRunning }: ComposerSlotContext) {
  const { t } = useI18n();
  const modelId = useModelSelectorStore((state) => state.modelId);
  const reasoningEffort = useModelSelectorStore((state) => state.reasoningEffort);
  const setModelId = useModelSelectorStore((state) => state.setModelId);
  const setReasoningEffort = useModelSelectorStore((state) => state.setReasoningEffort);
  const effortOptions = [
    { id: "low", name: t("extensions.modelSelector.low") },
    { id: "medium", name: t("extensions.modelSelector.medium") },
    { id: "high", name: t("extensions.modelSelector.high") },
  ] satisfies readonly ModelSelectorEffortOption[];
  const models = MODEL_OPTIONS.map((option): ModelOption => ({
    ...option,
    description:
      option.id === "gpt-5.6-luna"
        ? t("extensions.modelSelector.fast")
        : option.id === "gpt-5.6-terra"
          ? t("extensions.modelSelector.balanced")
          : t("extensions.modelSelector.capable"),
    efforts: "efforts" in option && option.efforts ? effortOptions : undefined,
  }));

  return (
    <fieldset
      className="min-w-0 disabled:pointer-events-none disabled:opacity-50"
      disabled={isRunning}
      title={isRunning ? t("extensions.modelSelector.locked") : undefined}
    >
      <AssistantModelSelector
        models={models}
        value={modelId}
        effort={reasoningEffort}
        searchable
        variant="ghost"
        size="sm"
        align="end"
        className="h-9 max-w-48 border-0 bg-transparent px-2.5 text-sm shadow-none hover:bg-muted/70 [&>svg]:hidden"
        onValueChange={(value) => {
          const model = MODEL_OPTIONS.find((option) => option.id === value);
          if (model) setModelId(model.id);
        }}
        onEffortChange={(effort) => {
          if (REASONING_EFFORTS.has(effort as ReasoningEffort)) {
            setReasoningEffort(effort as ReasoningEffort);
          }
        }}
      />
    </fieldset>
  );
}
