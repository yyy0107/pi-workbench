"use client";

import { useAppearancePreferences } from "@/services/appearance/appearance-store";

import { useMediaQuery } from "./use-media-query";

const REDUCED_MOTION_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  const systemPrefersReducedMotion = useMediaQuery(REDUCED_MOTION_MEDIA_QUERY);
  const { reduceMotion: applicationPrefersReducedMotion } = useAppearancePreferences();
  return systemPrefersReducedMotion || applicationPrefersReducedMotion;
}
