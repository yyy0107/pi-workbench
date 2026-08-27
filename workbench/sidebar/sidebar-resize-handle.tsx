"use client";

import { useRef, type RefObject } from "react";

import { useSidebar } from "@/components/ui/sidebar";
import {
  resolveCollapsibleResizePreview,
  useCollapsibleResize,
} from "@/hooks/use-collapsible-resize";
import { useI18n } from "@/i18n";

const NORMAL_SIDEBAR_WIDTH = 268;
const WIDE_SIDEBAR_WIDTH = 420;

export interface SidebarResizeHandleProps {
  width: number;
  minWidth: number;
  maxWidth: number;
  shellRef: RefObject<HTMLElement | null>;
  onResize(width: number): void;
}

export function SidebarResizeHandle({
  width,
  minWidth,
  maxWidth,
  shellRef,
  onResize,
}: SidebarResizeHandleProps) {
  const { t } = useI18n();
  const { setCollapsePreview, setOpen } = useSidebar();
  const collapsePreviewRef = useRef(false);
  const updateCollapsePreview = (collapsePreview: boolean) => {
    if (collapsePreviewRef.current === collapsePreview) return;
    collapsePreviewRef.current = collapsePreview;
    setCollapsePreview(collapsePreview);
  };
  const resize = useCollapsibleResize({
    width,
    minimumWidth: minWidth,
    direction: 1,
    getMaximumWidth: () => Math.min(maxWidth, Math.floor(window.innerWidth / 2)),
    getRenderedWidth: () =>
      shellRef.current
        ? Number.parseFloat(
            window.getComputedStyle(shellRef.current).getPropertyValue("--sidebar-width"),
          ) || width
        : width,
    getSnapPoints: () => [NORMAL_SIDEBAR_WIDTH, WIDE_SIDEBAR_WIDTH],
    onPreview: (nextWidth) => {
      const preview = resolveCollapsibleResizePreview(nextWidth, minWidth, 1);
      shellRef.current?.style.setProperty("--sidebar-width", `${preview.layoutWidth}px`);
      shellRef.current?.style.setProperty("--sidebar-content-width", `${preview.contentWidth}px`);
      shellRef.current?.style.setProperty(
        "--sidebar-resize-translate-x",
        `${preview.translateX}px`,
      );
      updateCollapsePreview(preview.layoutWidth < minWidth);
    },
    onCommit: onResize,
    onOpenChange: setOpen,
    onResizingChange: (resizing) => {
      if (resizing) shellRef.current?.setAttribute("data-resizing", "true");
      else {
        shellRef.current?.removeAttribute("data-resizing");
        updateCollapsePreview(false);
      }
    },
  });

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={t("workbench.sidebar.resize")}
      aria-orientation="vertical"
      aria-valuenow={Math.round(width)}
      aria-valuemin={Math.round(minWidth)}
      aria-valuemax={Math.round(maxWidth)}
      data-slot="workbench-sidebar-resize-handle"
      className="group absolute inset-y-0 -right-[5px] z-30 w-[10px] touch-none cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent after:blur-[0.35px] after:transition-colors hover:after:bg-ring/30 focus-visible:after:bg-ring/50"
      onPointerDown={resize.onPointerDown}
      onPointerMove={resize.onPointerMove}
      onPointerUp={resize.onPointerUp}
      onPointerCancel={resize.onPointerCancel}
      onKeyDown={resize.onKeyDown}
    />
  );
}
