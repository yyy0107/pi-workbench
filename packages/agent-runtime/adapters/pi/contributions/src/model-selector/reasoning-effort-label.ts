import {
  isPiThinkingLevel,
  type PiThinkingLevel,
} from "@workbench/agent-runtime-pi-protocol/messages";

import type { PiStaticMessageKey, PiTranslate } from "../i18n";
import type { SelectorEffort } from "./model-selector-state";

const PI_REASONING_EFFORT_MESSAGE_KEYS = {
  off: "extensions.modelSelector.off",
  minimal: "extensions.modelSelector.minimal",
  low: "extensions.modelSelector.low",
  medium: "extensions.modelSelector.medium",
  high: "extensions.modelSelector.high",
  xhigh: "extensions.modelSelector.xhigh",
  max: "extensions.modelSelector.max",
} as const satisfies Record<PiThinkingLevel, PiStaticMessageKey>;

export function reasoningEffortLabel(
  effort: Pick<SelectorEffort, "id" | "name">,
  t: PiTranslate,
): string {
  if (!isPiThinkingLevel(effort.id)) return effort.name;
  return t(PI_REASONING_EFFORT_MESSAGE_KEYS[effort.id]);
}
