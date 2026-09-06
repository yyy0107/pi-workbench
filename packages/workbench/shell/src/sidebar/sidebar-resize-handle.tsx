"use client";

import type { RefObject } from "react";

import { useSidebar } from "../ui/sidebar";
import { CollapsibleResizeHandle } from "../ui/collapsible-resize-handle";
import { useI18n } from "../i18n";
import { resolveCollapsibleResizePreview } from "../resize";

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
  // Shell style mutations invalidate the whole tree and notify appearance observers.
  shell
    ?.querySelector<HTMLElement>('[data-workbench-surface="header"]')
    ?.style.setProperty("--sidebar-width", `${preview.layoutWidth}px`);
  shell
    ?.querySelector<HTMLElement>("[data-main-view-sidebar-rail]")
    ?.style.setProperty(
      "--sidebar-collapse-progress",
      String(minimumWidth > 0 ? Math.max(0, 1 - preview.layoutWidth / minimumWidth) : 0),
    );
  if (preview.layoutWidth < minimumWidth) {
    if (shell?.getAttribute("data-sidebar-collapse-preview") !== "true") {
      shell?.setAttribute("data-sidebar-collapse-preview", "true");
    }
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
  const { setOpen, setCollapsePreview } = useSidebar();

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
        setCollapsePreview(nextWidth < minWidth);
      }}
      onCommit={onResize}
      onOpenChange={setOpen}
      onResizingChange={(resizing) => {
        if (!resizing) {
          setCollapsePreview(false);
          shellRef.current?.removeAttribute("data-sidebar-collapse-preview");
        }
        if (resizing) shellRef.current?.setAttribute("data-sidebar-resizing", "true");
        else shellRef.current?.removeAttribute("data-sidebar-resizing");
        for (const element of [sidebarLayoutRef.current, shellRef.current]) {
          if (resizing) element?.setAttribute("data-resizing", "true");
          else element?.removeAttribute("data-resizing");
        }
      }}
    />
  );
}
