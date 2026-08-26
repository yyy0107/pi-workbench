"use client";

import { ThinkingOrb } from "thinking-orbs";

import type { PiWorkingOrbState } from "@/services/appearance/appearance-preferences";

type PiWorkingOrbProps = Readonly<{
  state: PiWorkingOrbState;
  paused?: boolean;
  className?: string;
}>;

const PI_WORKING_ORB_SPEED = 3;

export function PiWorkingOrb({ state, paused, className }: PiWorkingOrbProps) {
  return (
    <ThinkingOrb
      aria-hidden="true"
      role="presentation"
      state={state}
      size={20}
      speed={PI_WORKING_ORB_SPEED}
      paused={paused}
      className={className}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
