"use client";

import type { RefObject } from "react";

import { useSidebar } from "@/components/ui/sidebar";
import { CollapsibleResizeHandle } from "@/components/ui/collapsible-resize-handle";
import { resolveCollapsibleResizePreview } from "@/hooks/use-collapsible-resize";
import { useI18n } from "@/i18n";

const NORMAL_SIDEBAR_WIDTH = 268;
const WIDE_SIDEBAR_WIDTH = 420;

export function applySidebarResizePreview(
  sidebarLayout: HTMLElement | null,
  shell: HTMLElement | null,
  width: number,
  minimumWidth: number,
): void {
  const preview = resolveCollapsibleResizePreview(width, minimumWidth, 1);
  sidebarLayout?.style.setProperty("--workbench-sidebar-layout-width", `${preview.layoutWidth}px`);
  sidebarLayout?.style.setProperty(
    "--workbench-sidebar-content-width",
    `${preview.contentWidth}px`,
  );
  sidebarLayout?.style.setProperty(
    "--workbench-sidebar-resize-translate-x",
    `${preview.translateX}px`,
  );
  shell?.style.setProperty("--sidebar-width", `${preview.layoutWidth}px`);
  shell?.style.setProperty("--sidebar-content-width", `${preview.contentWidth}px`);
  shell?.style.setProperty("--sidebar-resize-translate-x", `${preview.translateX}px`);
  if (preview.layoutWidth < minimumWidth) {
    shell?.setAttribute("data-sidebar-collapse-preview", "true");
  } else {
    shell?.removeAttribute("data-sidebar-collapse-preview");
  }
}

export interface SidebarResizeHandleProps {
  width: number;
  minWidth: number;
  maxWidth: number;
  sidebarLayoutRef: RefObject<HTMLElement | null>;
  shellRef: RefObject<HTMLElement | null>;
  onResize(width: number): void;
}

export function SidebarResizeHandle({
  width,
  minWidth,
  maxWidth,
  sidebarLayoutRef,
  shellRef,
  onResize,
}: SidebarResizeHandleProps) {
  const { t } = useI18n();
  const { setOpen } = useSidebar();

  return (
    <CollapsibleResizeHandle
      ariaLabel={t("workbench.sidebar.resize")}
      dataSlot="workbench-sidebar-resize-handle"
      edge="inline-end"
      width={width}
      minimumWidth={minWidth}
      maximumWidth={maxWidth}
      direction={1}
      getRenderedWidth={() => sidebarLayoutRef.current?.getBoundingClientRect().width || width}
      getSnapPoints={() => [NORMAL_SIDEBAR_WIDTH, WIDE_SIDEBAR_WIDTH]}
      onPreview={(nextWidth) => {
        applySidebarResizePreview(sidebarLayoutRef.current, shellRef.current, nextWidth, minWidth);
      }}
      onCommit={onResize}
      onOpenChange={setOpen}
      onResizingChange={(resizing) => {
        for (const element of [sidebarLayoutRef.current, shellRef.current]) {
          if (resizing) element?.setAttribute("data-resizing", "true");
          else element?.removeAttribute("data-resizing");
        }
      }}
    />
  );
}
