"use client";

import { useCallback, useLayoutEffect, useState, type RefObject } from "react";

import { resolvePanelShare } from "./proportional-panel-size";

/** Only an explicit width change captures a new proportion. CSS handles parent motion. */
export function useProportionalPanelSize(
  panelRef: RefObject<HTMLElement | null>,
  preferredWidth: number,
) {
  const [size, setSize] = useState({ share: 0 });
  const captureWidth = useCallback(
    (width: number) => {
      const parent = panelRef.current?.parentElement;
      // A same-width commit still needs to release its pixel drag preview.
      if (parent)
        setSize({ share: resolvePanelShare(width, parent.getBoundingClientRect().width) });
    },
    [panelRef],
  );
  useLayoutEffect(() => captureWidth(preferredWidth), [captureWidth, preferredWidth]);
  return [size, captureWidth] as const;
}
