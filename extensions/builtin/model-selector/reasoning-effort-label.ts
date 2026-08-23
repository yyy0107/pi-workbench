import type { StaticMessageKey, Translate } from "@/i18n";
import { PI_THINKING_LEVELS, type PiThinkingLevel } from "@/runtime/pi/contracts";

import type { SelectorEffort } from "./model-selector-state";

const PI_REASONING_EFFORT_MESSAGE_KEYS = {
  off: "extensions.modelSelector.off",
  minimal: "extensions.modelSelector.minimal",
  low: "extensions.modelSelector.low",
  medium: "extensions.modelSelector.medium",
  high: "extensions.modelSelector.high",
  xhigh: "extensions.modelSelector.xhigh",
  max: "extensions.modelSelector.max",
} as const satisfies Record<PiThinkingLevel, StaticMessageKey>;

function isPiThinkingLevel(value: string): value is PiThinkingLevel {
  return (PI_THINKING_LEVELS as readonly string[]).includes(value);
}

export function reasoningEffortLabel(
  effort: Pick<SelectorEffort, "id" | "name">,
  t: Translate,
): string {
  if (!isPiThinkingLevel(effort.id)) return effort.name;
  return t(PI_REASONING_EFFORT_MESSAGE_KEYS[effort.id]);
}
