"use client";

import { useRef, type RefObject } from "react";

import { CollapsibleResizeHandle } from "../../ui/collapsible-resize-handle";
import { useI18n } from "../../i18n";
import {
  DEFAULT_RIGHT_WORKSPACE_WIDTH,
  MIN_RIGHT_WORKSPACE_WIDTH,
  applyRightWorkspaceResizePreview,
} from "../../right-workspace";
import { useRightWorkspace } from "../../right-workspace-react";
import { beginRightWorkspaceResize } from "../workspace-resize-preview";

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
  const finishResizeRef = useRef<(() => void) | null>(null);

  return (
    <CollapsibleResizeHandle
      ariaLabel={t("rightWorkspace.resize")}
      dataSlot="right-workspace-resize-handle"
      edge="inline-start"
      width={width}
      minimumWidth={MIN_RIGHT_WORKSPACE_WIDTH}
      maximumWidth={maximum}
      direction={-1}
      getRenderedWidth={() => workspaceRef.current?.getBoundingClientRect().width || width}
      getSnapPoints={() => [DEFAULT_RIGHT_WORKSPACE_WIDTH, WIDE_RIGHT_WORKSPACE_WIDTH]}
      onPreview={(nextWidth) => {
        applyRightWorkspaceResizePreview(workspaceRef.current, nextWidth);
      }}
      onCommit={controller.setWidth}
      onOpenChange={controller.setWorkspaceOpen}
      onResizingChange={(resizing) => {
        finishResizeRef.current?.();
        finishResizeRef.current = resizing ? beginRightWorkspaceResize(workspaceRef.current) : null;
      }}
    />
  );
}
