"use client";

import type { RefObject } from "react";

import { useCollapsibleResize } from "@/hooks/use-collapsible-resize";
import { useI18n } from "@/i18n";

import { DEFAULT_RIGHT_WORKSPACE_WIDTH, MIN_RIGHT_WORKSPACE_WIDTH } from "./core/workspace-store";
import { useRightWorkspace } from "./workspace-context";

const WIDE_RIGHT_WORKSPACE_WIDTH = 720;

export function WorkspaceResizeHandle({
  width,
  maximum,
  workspaceRef,
}: Readonly<{
  width: number;
  maximum: number;
  workspaceRef: RefObject<HTMLElement | null>;
}>) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const resize = useCollapsibleResize({
    width,
    minimumWidth: MIN_RIGHT_WORKSPACE_WIDTH,
    direction: -1,
    getMaximumWidth: () => maximum,
    getRenderedWidth: () => workspaceRef.current?.getBoundingClientRect().width || width,
    getSnapPoints: () => [DEFAULT_RIGHT_WORKSPACE_WIDTH, WIDE_RIGHT_WORKSPACE_WIDTH],
    onPreview: (nextWidth) => {
      workspaceRef.current?.style.setProperty("--right-workspace-width", `${nextWidth}px`);
    },
    onCommit: controller.setWidth,
    onOpenChange: controller.setWorkspaceOpen,
    onResizingChange: (resizing) => {
      if (resizing) workspaceRef.current?.setAttribute("data-resizing", "true");
      else workspaceRef.current?.removeAttribute("data-resizing");
    },
  });

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={t("rightWorkspace.resize")}
      aria-orientation="vertical"
      aria-valuemin={MIN_RIGHT_WORKSPACE_WIDTH}
      aria-valuemax={Math.round(maximum)}
      aria-valuenow={Math.round(width)}
      className="group absolute inset-y-0 -left-[5px] z-40 w-[10px] touch-none cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent hover:after:bg-ring focus-visible:after:bg-ring"
      onPointerDown={resize.onPointerDown}
      onPointerMove={resize.onPointerMove}
      onPointerUp={resize.onPointerUp}
      onPointerCancel={resize.onPointerCancel}
      onKeyDown={resize.onKeyDown}
    />
  );
}
