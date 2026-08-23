"use client";

import { useCallback, useRef } from "react";
import { useScrollLock } from "@assistant-ui/react";

const DISCLOSURE_ANIMATION_DURATION = 200;

export function useDisclosureScrollLock(onOpenChange: (open: boolean) => void) {
  const rootRef = useRef<HTMLDivElement>(null);
  const lockScroll = useScrollLock(rootRef, DISCLOSURE_ANIMATION_DURATION);
  const handleOpenChange = useCallback(
    (open: boolean) => {
      lockScroll();
      onOpenChange(open);
    },
    [lockScroll, onOpenChange],
  );

  return [rootRef, handleOpenChange] as const;
}
