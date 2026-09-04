import type { StaticMessageKey, Translate } from "@workbench/shell/i18n";
import type { SelectorEffort } from "./model-selector-state";

const REASONING_EFFORT_MESSAGE_KEYS = {
  off: "extensions.modelSelector.off",
  minimal: "extensions.modelSelector.minimal",
  low: "extensions.modelSelector.low",
  medium: "extensions.modelSelector.medium",
  high: "extensions.modelSelector.high",
  xhigh: "extensions.modelSelector.xhigh",
  max: "extensions.modelSelector.max",
} as const satisfies Record<string, StaticMessageKey>;

export function reasoningEffortLabel(
  effort: Pick<SelectorEffort, "id" | "name">,
  t: Translate,
): string {
  const key =
    REASONING_EFFORT_MESSAGE_KEYS[effort.id as keyof typeof REASONING_EFFORT_MESSAGE_KEYS];
  return Object.hasOwn(REASONING_EFFORT_MESSAGE_KEYS, effort.id) ? t(key) : effort.name;
}
