"use client";
import type { ComponentType, CSSProperties } from "react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import type { RunningIndicatorRenderProps } from "@workbench/shell-context/running-indicator";

export function createThinkingOrbRenderer(
  state: OrbState,
): ComponentType<RunningIndicatorRenderProps> {
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
