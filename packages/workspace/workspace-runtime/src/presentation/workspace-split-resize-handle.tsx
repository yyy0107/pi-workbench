"use client";
import { workspaceTranslationBundle } from "../i18n";
import { useI18n } from "@workbench/i18n";

import { useRef, type RefObject } from "react";

import { MIN_AUXILIARY_SURFACE_WIDTH, auxiliarySurfaceSnapPoints } from "../index";
import { useCollapsibleResize } from "@workbench/ui/resize";
import { useRightWorkspace } from "../react";
import { beginRightWorkspaceResize } from "../workspace-resize-preview";

export function WorkspaceSplitResizeHandle({
  width,
  maximum,
  paneRef,
}: Readonly<{
  width: number;
  maximum: number;
  paneRef: RefObject<HTMLElement | null>;
}>) {
  const { t } = useI18n(workspaceTranslationBundle);
  const controller = useRightWorkspace();
  const finishResizeRef = useRef<(() => void) | null>(null);
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
      finishResizeRef.current?.();
      finishResizeRef.current = resizing ? beginRightWorkspaceResize(paneRef.current) : null;
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
