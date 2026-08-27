"use client";

import { useId } from "react";
import { ThinkingOrb } from "thinking-orbs";

import type { PiWorkingOrbState } from "@/services/appearance/appearance-preferences";

type PiWorkingOrbProps = Readonly<{
  state: PiWorkingOrbState;
  paused?: boolean;
  className?: string;
}>;

const PI_WORKING_ORB_SPEED = 3;

export const PI_WORKING_WORDMARK_ASPECT_RATIO = 776 / 112;

export function isPiWorkingWordmarkState(
  state: PiWorkingOrbState,
): state is "pi-wordmark-on-light" | "pi-wordmark-on-dark" {
  return state === "pi-wordmark-on-light" || state === "pi-wordmark-on-dark";
}

const PI_LOGO_PRIMARY_PATH = `
  M165.29 165.29
  H517.36
  V400
  H400
  V517.36
  H282.65
  V634.72
  H165.29
  Z
  M282.65 282.65
  V400
  H400
  V282.65
  Z
`;

const PI_LOGO_SECONDARY_PATH = "M517.36 400 H634.72 V634.72 H517.36 Z";

const PI_WORKING_WORDMARK_PIXELS = [
  [0, 0],
  [16, 0],
  [32, 0],
  [0, 16],
  [32, 16],
  [0, 32],
  [16, 32],
  [48, 32],
  [0, 48],
  [48, 48],
  [88, 0],
  [152, 0],
  [88, 16],
  [120, 16],
  [152, 16],
  [88, 32],
  [104, 32],
  [136, 32],
  [152, 32],
  [88, 48],
  [152, 48],
  [184, 0],
  [200, 0],
  [216, 0],
  [232, 0],
  [184, 16],
  [232, 16],
  [184, 32],
  [232, 32],
  [184, 48],
  [200, 48],
  [216, 48],
  [232, 48],
  [264, 0],
  [280, 0],
  [296, 0],
  [264, 16],
  [312, 16],
  [264, 32],
  [280, 32],
  [296, 32],
  [264, 48],
  [312, 48],
  [344, 0],
  [392, 0],
  [344, 16],
  [376, 16],
  [360, 24],
  [344, 32],
  [376, 32],
  [344, 48],
  [392, 48],
  [424, 0],
  [440, 0],
  [456, 0],
  [440, 16],
  [440, 32],
  [424, 48],
  [440, 48],
  [456, 48],
  [488, 0],
  [536, 0],
  [488, 16],
  [504, 16],
  [536, 16],
  [488, 32],
  [520, 32],
  [536, 32],
  [488, 48],
  [536, 48],
  [568, 0],
  [584, 0],
  [600, 0],
  [616, 0],
  [568, 16],
  [568, 32],
  [600, 32],
  [616, 32],
  [568, 48],
  [584, 48],
  [600, 48],
  [616, 48],
  [648, 48],
  [680, 48],
  [712, 48],
] as const;

function PiWorkingWordmark({
  darkTheme,
  paused,
  className,
}: Readonly<{
  darkTheme: boolean;
  paused?: boolean;
  className?: string;
}>) {
  const symbolId = useId();
  const glowFilterId = useId();
  const shineGradientId = useId();
  const inkColor = darkTheme ? "#ffffff" : "#09090b";
  const shineColor = darkTheme ? "#09090b" : "#ffffff";
  const shineAccentColor = darkTheme ? "#075985" : "#c7f0ff";
  const glowColor = "#7dd3fc";

  return (
    <svg
      aria-hidden="true"
      role="presentation"
      viewBox="-24 -24 776 112"
      width="100%"
      height="100%"
      shapeRendering="crispEdges"
      className={className}
    >
      <defs>
        <symbol id={symbolId} overflow="visible">
          {PI_WORKING_WORDMARK_PIXELS.map(([x, y]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width="16" height="16" />
          ))}
        </symbol>

        <filter
          id={glowFilterId}
          x="-10%"
          y="-50%"
          width="120%"
          height="200%"
          colorInterpolationFilters="sRGB"
        >
          <feMorphology in="SourceAlpha" operator="dilate" radius="1" result="spread" />
          <feGaussianBlur in="spread" stdDeviation="4" result="blur" />
          <feFlood floodColor={glowColor} floodOpacity="0.78" result="glowColor" />
          <feComposite in="glowColor" in2="blur" operator="in" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
          </feMerge>
        </filter>

        <linearGradient
          id={shineGradientId}
          gradientUnits="userSpaceOnUse"
          x1="-180"
          y1="0"
          x2="-20"
          y2="64"
        >
          <stop offset="0%" stopColor={shineColor} stopOpacity="0" />
          <stop offset="38%" stopColor={shineColor} stopOpacity="0" />
          <stop offset="50%" stopColor={shineColor} stopOpacity="0.95" />
          <stop offset="58%" stopColor={shineAccentColor} stopOpacity="0.9" />
          <stop offset="68%" stopColor={shineColor} stopOpacity="0" />
          <stop offset="100%" stopColor={shineColor} stopOpacity="0" />
          {paused ? null : (
            <>
              <animate attributeName="x1" values="-180;860" dur="2.2s" repeatCount="indefinite" />
              <animate attributeName="x2" values="-20;1020" dur="2.2s" repeatCount="indefinite" />
            </>
          )}
        </linearGradient>
      </defs>

      <use href={`#${symbolId}`} fill={glowColor} filter={`url(#${glowFilterId})`} opacity="0.55">
        {paused ? null : (
          <animate
            attributeName="opacity"
            values="0.42;0.78;0.42"
            dur="2.4s"
            repeatCount="indefinite"
          />
        )}
      </use>
      <use href={`#${symbolId}`} fill={inkColor} />
      <use href={`#${symbolId}`} fill={`url(#${shineGradientId})`} opacity="0.95" />
    </svg>
  );
}

function PiLogoShine({
  inverted,
  paused,
  className,
}: Readonly<{
  inverted: boolean;
  paused?: boolean;
  className?: string;
}>) {
  const clipPathId = useId();
  const gradientId = useId();
  const logoColor = inverted ? "#ffffff" : "#09090b";
  const shineColor = inverted ? "#09090b" : "#ffffff";

  return (
    <svg
      aria-hidden="true"
      role="presentation"
      viewBox="0 0 800 800"
      width="100%"
      height="100%"
      className={className}
    >
      <defs>
        <clipPath id={clipPathId}>
          <path d={PI_LOGO_PRIMARY_PATH} fillRule="evenodd" clipRule="evenodd" />
          <path d={PI_LOGO_SECONDARY_PATH} />
        </clipPath>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={shineColor} stopOpacity="0" />
          <stop offset="38%" stopColor={shineColor} stopOpacity="0" />
          <stop offset="50%" stopColor={shineColor} stopOpacity="0.95" />
          <stop offset="62%" stopColor={shineColor} stopOpacity="0" />
          <stop offset="100%" stopColor={shineColor} stopOpacity="0" />
        </linearGradient>
      </defs>

      <g fill={logoColor}>
        <path d={PI_LOGO_PRIMARY_PATH} fillRule="evenodd" />
        <path d={PI_LOGO_SECONDARY_PATH} />
      </g>

      <g clipPath={`url(#${clipPathId})`}>
        <g transform="rotate(-22 400 400)">
          <rect x="-500" y="0" width="240" height="800" fill={`url(#${gradientId})`} opacity="0.9">
            {paused ? null : (
              <animate attributeName="x" values="-500;1100" dur="1.8s" repeatCount="indefinite" />
            )}
          </rect>
        </g>
      </g>
    </svg>
  );
}

export function PiWorkingOrb({ state, paused, className }: PiWorkingOrbProps) {
  if (isPiWorkingWordmarkState(state)) {
    return (
      <PiWorkingWordmark
        darkTheme={state === "pi-wordmark-on-dark"}
        paused={paused}
        className={className}
      />
    );
  }

  if (state === "pi-logo-shine" || state === "pi-logo-shine-inverted") {
    return (
      <PiLogoShine
        inverted={state === "pi-logo-shine-inverted"}
        paused={paused}
        className={className}
      />
    );
  }

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
