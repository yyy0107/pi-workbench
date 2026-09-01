"use client";

import {
  createContext,
  useContext,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";

import { defineMessage, type LocalizableText } from "./i18n";

export interface RunningIndicatorRenderProps {
  readonly className?: string;
  readonly paused?: boolean;
}

export interface RunningIndicatorPresentation {
  /** Width divided by height when the indicator is placed inline. Defaults to 1. */
  readonly aspectRatio?: number;
  /** Hides the adjacent activity label, for definitions that render their own wordmark. */
  readonly hideLabel?: boolean;
  /** Gives a definition the larger, centered preview layout in Appearance settings. */
  readonly previewOnly?: boolean;
  readonly previewClassName?: string;
}

export interface RunningIndicatorDefinition {
  readonly id: string;
  readonly label: LocalizableText;
  readonly render: ComponentType<RunningIndicatorRenderProps>;
  readonly presentation?: RunningIndicatorPresentation;
}

export interface RunningIndicatorCatalog {
  readonly defaultStyleId: string;
  readonly definitions: readonly RunningIndicatorDefinition[];
  resolve(styleId: string): RunningIndicatorDefinition;
}

export function createRunningIndicatorCatalog({
  defaultStyleId,
  definitions,
}: Readonly<{
  defaultStyleId: string;
  definitions: readonly RunningIndicatorDefinition[];
}>): RunningIndicatorCatalog {
  if (!defaultStyleId.trim())
    throw new Error("Running indicator default style id must not be empty");

  const definitionsById = new Map<string, RunningIndicatorDefinition>();
  const installedDefinitions = definitions.map((definition) => {
    if (!definition.id.trim()) throw new Error("Running indicator style id must not be empty");
    if (definitionsById.has(definition.id)) {
      throw new Error(`Duplicate running indicator style id "${definition.id}"`);
    }
    const installed = Object.freeze({
      ...definition,
      presentation: definition.presentation
        ? Object.freeze({ ...definition.presentation })
        : undefined,
    });
    definitionsById.set(installed.id, installed);
    return installed;
  });
  const fallback = definitionsById.get(defaultStyleId);
  if (!fallback) {
    throw new Error(`Unknown default running indicator style id "${defaultStyleId}"`);
  }

  return Object.freeze({
    defaultStyleId,
    definitions: Object.freeze(installedDefinitions),
    resolve: (styleId: string) => definitionsById.get(styleId) ?? fallback,
  });
}

const RunningIndicatorContext = createContext<RunningIndicatorCatalog | null>(null);

export function RunningIndicatorProvider({
  catalog,
  children,
}: Readonly<{ catalog: RunningIndicatorCatalog; children: ReactNode }>) {
  return (
    <RunningIndicatorContext.Provider value={catalog}>{children}</RunningIndicatorContext.Provider>
  );
}

export function useRunningIndicatorCatalog(): RunningIndicatorCatalog {
  const catalog = useContext(RunningIndicatorContext);
  if (!catalog) {
    throw new Error("useRunningIndicatorCatalog must be used within a RunningIndicatorProvider");
  }
  return catalog;
}

export function RunningIndicator({
  styleId,
  paused,
  className,
}: RunningIndicatorRenderProps & Readonly<{ styleId: string }>) {
  const definition = useRunningIndicatorCatalog().resolve(styleId);
  const Indicator = definition.render;
  return (
    <span data-running-indicator-style={definition.id} className="contents">
      <Indicator paused={paused} className={className} />
    </span>
  );
}

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

function createThinkingOrbRenderer(state: OrbState): ComponentType<RunningIndicatorRenderProps> {
  function ThinkingOrbIndicator({ paused, className }: RunningIndicatorRenderProps) {
    return (
      <ThinkingOrb
        aria-hidden="true"
        role="presentation"
        state={state}
        size={20}
        speed={3}
        paused={paused}
        className={className}
        style={{ width: "100%", height: "100%" } as CSSProperties}
      />
    );
  }
  ThinkingOrbIndicator.displayName = `ThinkingOrbIndicator(${state})`;
  return ThinkingOrbIndicator;
}

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
