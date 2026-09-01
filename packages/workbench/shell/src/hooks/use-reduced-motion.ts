"use client";

import { useMediaQuery } from "./use-media-query";

const REDUCED_MOTION_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_MEDIA_QUERY);
}
