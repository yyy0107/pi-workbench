"use client";

import { useRef, type RefObject } from "react";

import { useCollapsibleResize } from "@/hooks/use-collapsible-resize";
import { useI18n } from "@/i18n";

import {
  MIN_AUXILIARY_SURFACE_WIDTH,
  auxiliarySurfaceSnapPoints,
} from "./core/workspace-split-layout";
import { useRightWorkspace } from "./workspace-context";

export function WorkspaceSplitResizeHandle({
  width,
  maximum,
  paneRef,
}: Readonly<{
  width: number;
  maximum: number;
  paneRef: RefObject<HTMLElement | null>;
}>) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const resizingWorkspace = useRef<HTMLElement | null>(null);
  const resize = useCollapsibleResize({
    width,
    minimumWidth: MIN_AUXILIARY_SURFACE_WIDTH,
    direction: -1,
    getMaximumWidth: () => maximum,
    getRenderedWidth: () => paneRef.current?.getBoundingClientRect().width || width,
    getSnapPoints: auxiliarySurfaceSnapPoints,
    onPreview: (nextWidth) => {
      paneRef.current?.style.setProperty("width", `${nextWidth}px`);
    },
    onCommit: controller.setAuxiliaryWidth,
    onOpenChange: controller.setAuxiliaryOpen,
    onResizingChange: (resizing) => {
      if (resizing) {
        const workspace =
          paneRef.current?.closest<HTMLElement>('[data-workbench-surface="right-workspace"]') ??
          null;
        resizingWorkspace.current = workspace;
        workspace?.setAttribute("data-resizing", "true");
        return;
      }

      resizingWorkspace.current?.removeAttribute("data-resizing");
      resizingWorkspace.current = null;
    },
  });

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={t("rightWorkspace.resizeAuxiliary")}
      aria-orientation="vertical"
      aria-valuemin={MIN_AUXILIARY_SURFACE_WIDTH}
      aria-valuemax={Math.round(maximum)}
      aria-valuenow={Math.round(width)}
      className="group relative z-30 -mx-1 w-2 shrink-0 touch-none cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border after:blur-[0.35px] hover:after:bg-ring/30 focus-visible:after:bg-ring/50"
      onPointerDown={resize.onPointerDown}
      onPointerMove={resize.onPointerMove}
      onPointerUp={resize.onPointerUp}
      onPointerCancel={resize.onPointerCancel}
      onKeyDown={resize.onKeyDown}
    />
  );
}
