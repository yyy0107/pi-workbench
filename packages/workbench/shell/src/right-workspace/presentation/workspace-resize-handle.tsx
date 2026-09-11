"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

import { CollapsibleResizeHandle } from "../../ui/collapsible-resize-handle";
import { useI18n } from "../../i18n";
import {
  DEFAULT_RIGHT_WORKSPACE_WIDTH,
  MIN_RIGHT_WORKSPACE_WIDTH,
  applyRightWorkspaceResizePreview,
} from "../../right-workspace";
import { useRightWorkspace } from "../../right-workspace-react";
import { beginRightWorkspaceResize } from "../workspace-resize-preview";

import { resolveRightWorkspaceMaximumWidth } from "../right-workspace-layout";
import { observeResizeHandle } from "../../resize/observe-resize-handle";

const WIDE_RIGHT_WORKSPACE_WIDTH = 720;

export function WorkspaceResizeHandle({
  width,
  workspaceRef,
  onCommit,
}: Readonly<{
  width: number;
  workspaceRef: RefObject<HTMLElement | null>;
  onCommit(width: number): void;
}>) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const finishResizeRef = useRef<(() => void) | null>(null);

  const handleRef = useRef<HTMLDivElement>(null);
  const geometryRef = useRef({ width, maximum: width });
  useLayoutEffect(() => {
    const layout = workspaceRef.current;
    const handle = handleRef.current;
    if (!layout || !handle) return;
    return observeResizeHandle(
      layout,
      handle,
      geometryRef.current,
      resolveRightWorkspaceMaximumWidth,
    );
  }, [workspaceRef]);

  return (
    <CollapsibleResizeHandle
      ref={handleRef}
      ariaLabel={t("rightWorkspace.resize")}
      dataSlot="right-workspace-resize-handle"
      edge="inline-start"
      width={geometryRef.current.width}
      minimumWidth={MIN_RIGHT_WORKSPACE_WIDTH}
      maximumWidth={geometryRef.current.maximum}
      getMaximumWidth={() => geometryRef.current.maximum}
      direction={-1}
      getRenderedWidth={() => workspaceRef.current?.getBoundingClientRect().width || width}
      getSnapPoints={() => [DEFAULT_RIGHT_WORKSPACE_WIDTH, WIDE_RIGHT_WORKSPACE_WIDTH]}
      onPreview={(nextWidth) => {
        applyRightWorkspaceResizePreview(workspaceRef.current, nextWidth);
      }}
      onCommit={onCommit}
      onOpenChange={controller.setWorkspaceOpen}
      onResizingChange={(resizing) => {
        finishResizeRef.current?.();
        finishResizeRef.current = resizing ? beginRightWorkspaceResize(workspaceRef.current) : null;
      }}
    />
  );
}
