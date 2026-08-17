"use client";

import {
  ModelSelector as AssistantModelSelector,
  type ModelOption,
} from "@/components/assistant-ui/model-selector";
import type { ComposerSlotContext } from "@/platform/extensions";

import { MODEL_OPTIONS, type ReasoningEffort, useModelSelectorStore } from "./model-selector-store";

const REASONING_EFFORTS = new Set<ReasoningEffort>(["low", "medium", "high"]);

export function ModelSelector({ isRunning }: ComposerSlotContext) {
  const modelId = useModelSelectorStore((state) => state.modelId);
  const reasoningEffort = useModelSelectorStore((state) => state.reasoningEffort);
  const setModelId = useModelSelectorStore((state) => state.setModelId);
  const setReasoningEffort = useModelSelectorStore((state) => state.setReasoningEffort);

  return (
    <fieldset
      className="min-w-0 disabled:pointer-events-none disabled:opacity-50"
      disabled={isRunning}
      title={isRunning ? "Model selection is locked while streaming" : undefined}
    >
      <AssistantModelSelector
        models={MODEL_OPTIONS satisfies readonly ModelOption[]}
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
