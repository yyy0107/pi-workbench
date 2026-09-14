"use client";

import { createContext, useContext, useLayoutEffect } from "react";

export type ReviewRenderReporter = (duration: number, path?: string) => void;
export const ReviewRenderTimingContext = createContext<ReviewRenderReporter | undefined>(undefined);
export const ReviewRenderPathContext = createContext<string | undefined>(undefined);

/** Works in production without a profiling React build. Measures render-to-commit
 * elapsed time, including scheduling/DOM work, not fetch waits or browser paint.
 * Only committed renders report; hidden documents are excluded from sampling. */
export function useReviewRenderTiming(reporter?: ReviewRenderReporter, filePath?: string) {
  const inheritedReporter = useContext(ReviewRenderTimingContext);
  const inheritedPath = useContext(ReviewRenderPathContext);
  const report = reporter ?? inheritedReporter;
  const path = filePath ?? inheritedPath;
  const visible = typeof document !== "undefined" && document.visibilityState === "visible";
  const startedAt = report && visible ? performance.now() : undefined;
  useLayoutEffect(() => {
    if (startedAt !== undefined && document.visibilityState === "visible") {
      report?.(performance.now() - startedAt, path);
    }
  });
}
