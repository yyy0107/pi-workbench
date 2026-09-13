"use client";

import { createThinkingOrbRenderer } from "../lib/thinking-orb-renderer";

import { type OrbState } from "thinking-orbs";
import { defineThemeMessage as defineMessage } from "@workbench/ui-theme/i18n";
import type { LocalizableText } from "@workbench/i18n";
import type { RunningIndicatorDefinition } from "@workbench/shell-context/running-indicator";

const SHELL_THINKING_ORB_STATES = [
  "working",
  "searching",
  "solving",
  "listening",
  "connecting",
  "weaving",
  "composing",
  "breathing",
  "shaping",
] as const satisfies readonly OrbState[];

const SHELL_RUNNING_INDICATOR_LABELS = {
  working: defineMessage("extensions.appearance.activityAnimation.styles.working"),
  searching: defineMessage("extensions.appearance.activityAnimation.styles.searching"),
  solving: defineMessage("extensions.appearance.activityAnimation.styles.solving"),
  listening: defineMessage("extensions.appearance.activityAnimation.styles.listening"),
  connecting: defineMessage("extensions.appearance.activityAnimation.styles.connecting"),
  weaving: defineMessage("extensions.appearance.activityAnimation.styles.weaving"),
  composing: defineMessage("extensions.appearance.activityAnimation.styles.composing"),
  breathing: defineMessage("extensions.appearance.activityAnimation.styles.breathing"),
  shaping: defineMessage("extensions.appearance.activityAnimation.styles.shaping"),
} satisfies Record<(typeof SHELL_THINKING_ORB_STATES)[number], LocalizableText>;

export const shellRunningIndicatorDefinitions: readonly RunningIndicatorDefinition[] =
  Object.freeze(
    SHELL_THINKING_ORB_STATES.map((state) =>
      Object.freeze({
        id: state,
        label: SHELL_RUNNING_INDICATOR_LABELS[state],
        render: createThinkingOrbRenderer(state),
      }),
    ),
  );

export const DEFAULT_RUNNING_INDICATOR_STYLE_ID = "connecting";
