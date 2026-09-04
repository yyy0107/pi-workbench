"use client";

import { useId, type ComponentType } from "react";

import type {
  RunningIndicatorDefinition,
  RunningIndicatorRenderProps,
} from "@workbench/shell/running-indicator";
import { useWorkbenchBranding } from "@workbench/shell/presentation";

import { definePiMessage } from "../i18n";

/** Persisted Pi activity styles from the former monolithic Workbench implementation. */
export const PI_RUNNING_INDICATOR_STYLE_IDS = [
  "pi-logo-shine",
  "pi-logo-shine-inverted",
  "pi-wordmark-on-light",
  "pi-wordmark-on-dark",
] as const;

export type PiRunningIndicatorStyleId = (typeof PI_RUNNING_INDICATOR_STYLE_IDS)[number];

export const PI_RUNNING_INDICATOR_WORDMARK_ASPECT_RATIO = 776 / 112;

export function isPiRunningIndicatorWordmarkStyle(
  styleId: string,
): styleId is "pi-wordmark-on-light" | "pi-wordmark-on-dark" {
  return styleId === "pi-wordmark-on-light" || styleId === "pi-wordmark-on-dark";
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
}: Readonly<{ darkTheme: boolean } & RunningIndicatorRenderProps>) {
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
}: Readonly<{ inverted: boolean } & RunningIndicatorRenderProps>) {
  const clipPathId = useId();
  const gradientId = useId();
  const { productLogoUrl } = useWorkbenchBranding();
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
      <image
        href={productLogoUrl}
        x="0"
        y="0"
        width="800"
        height="800"
        preserveAspectRatio="xMidYMid meet"
        style={inverted ? { filter: "invert(1)" } : undefined}
      />
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

/** Returns the render component for a persisted Pi activity-indicator style. */
export function createPiRunningIndicatorRenderer(
  styleId: PiRunningIndicatorStyleId,
): ComponentType<RunningIndicatorRenderProps> {
  function PiRunningIndicator(props: RunningIndicatorRenderProps) {
    if (styleId === "pi-wordmark-on-light" || styleId === "pi-wordmark-on-dark") {
      return <PiWorkingWordmark darkTheme={styleId === "pi-wordmark-on-dark"} {...props} />;
    }
    return <PiLogoShine inverted={styleId === "pi-logo-shine-inverted"} {...props} />;
  }
  PiRunningIndicator.displayName = `PiRunningIndicator(${styleId})`;
  return PiRunningIndicator;
}

/** Bundle-bound labels for each persisted Pi activity-indicator style. */
export const piRunningIndicatorLabels = Object.freeze({
  "pi-logo-shine": definePiMessage("extensions.runningIndicator.piLogoShine"),
  "pi-logo-shine-inverted": definePiMessage("extensions.runningIndicator.piLogoShineInverted"),
  "pi-wordmark-on-light": definePiMessage("extensions.runningIndicator.piWordmarkOnLight"),
  "pi-wordmark-on-dark": definePiMessage("extensions.runningIndicator.piWordmarkOnDark"),
} satisfies Readonly<Record<PiRunningIndicatorStyleId, RunningIndicatorDefinition["label"]>>);

export const piRunningIndicatorDefinitions: readonly RunningIndicatorDefinition[] = Object.freeze(
  PI_RUNNING_INDICATOR_STYLE_IDS.map((id) =>
    Object.freeze({
      id,
      label: piRunningIndicatorLabels[id],
      render: createPiRunningIndicatorRenderer(id),
      presentation: isPiRunningIndicatorWordmarkStyle(id)
        ? {
            aspectRatio: PI_RUNNING_INDICATOR_WORDMARK_ASPECT_RATIO,
            hideLabel: true,
            previewOnly: true,
            previewClassName:
              id === "pi-wordmark-on-light"
                ? "rounded-md border border-black/10 bg-white"
                : "rounded-md border border-white/10 bg-zinc-950",
          }
        : undefined,
    }),
  ),
);
