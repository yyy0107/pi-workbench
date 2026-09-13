"use client";
import { workspaceTranslationBundle } from "../i18n";
import { useI18n } from "@workbench/i18n";

import { useLayoutEffect, useRef, type CSSProperties } from "react";

import { MIN_RIGHT_WORKSPACE_WIDTH } from "@workbench/workspace-runtime";
import { resolveRightWorkspacePresentation } from "../index";
import { WorkspaceFeedbackLayer } from "../feedback/feedback-layer";
import { SurfaceHost } from "./surface-host";
import { useRightWorkspace, useRightWorkspaceState } from "../react";
import { WorkspaceHeader } from "./workspace-header";
import { WorkspaceResizeHandle } from "./workspace-resize-handle";
import { useWorkbenchDomIds } from "@workbench/shell-context/dom";
import { MIN_CONVERSATION_WIDTH } from "../right-workspace-layout";
import { proportionalPanelWidthCss } from "@workbench/ui-resize";
import { useProportionalPanelSize } from "@workbench/ui-resize";

export function RightWorkspace({ isVisible = true }: { isVisible?: boolean }) {
  const { t } = useI18n(workspaceTranslationBundle);
  const domIds = useWorkbenchDomIds();
  const controller = useRightWorkspace();
  const workspaceOpen = useRightWorkspaceState((state) => state.open);
  const open = isVisible && workspaceOpen;
  const width = useRightWorkspaceState((state) => state.width);
  const maximized = useRightWorkspaceState((state) => state.maximized);
  const workspaceLayoutRef = useRef<HTMLDivElement>(null);
  const presentation = resolveRightWorkspacePresentation(open, maximized);

  const [size, captureWidth] = useProportionalPanelSize(workspaceLayoutRef, width);
  const { share } = size;
  const proportionalWidth = proportionalPanelWidthCss({
    minimum: MIN_RIGHT_WORKSPACE_WIDTH,
    remainingMinimum: MIN_CONVERSATION_WIDTH,
  });

  useLayoutEffect(() => {
    const layout = workspaceLayoutRef.current;
    if (!open || !layout || layout.dataset.resizing === "true") return;
    // A committed drag returns to the shared proportional geometry. Parent animation
    // never writes pixel targets or starts a second width transition.
    for (const property of [
      "--right-workspace-layout-width",
      "--right-workspace-content-width",
      "--right-workspace-resize-translate-x",
    ])
      layout.style.removeProperty(property);
  }, [open, width, size]);

  return (
    <div
      ref={workspaceLayoutRef}
      data-slot="right-workspace-layout"
      data-state={open ? "open" : "closed"}
      data-maximized={maximized ? "true" : undefined}
      data-panel-share={share}
      className="relative h-full min-h-0 min-w-0 shrink-0 transition-[--workbench-panel-expansion,--workbench-panel-maximization] duration-(--layout-motion-duration) ease-(--layout-motion-ease) motion-reduce:transition-none data-[resizing=true]:transition-none data-[resizing=true]:will-change-[width] data-[state=closed]:pointer-events-none"
      style={
        {
          "--workbench-panel-share": share,
          "--workbench-panel-maximization": maximized ? 1 : 0,
          "--workbench-panel-expansion": open ? 1 : 0,
          "--workbench-panel-width": proportionalWidth,
          width:
            "calc(var(--right-workspace-layout-width, var(--workbench-panel-width)) * var(--workbench-panel-expansion))",
          maxWidth: "100%",
        } as CSSProperties
      }
    >
      <section
        id={domIds.rightWorkspace}
        aria-label={t("rightWorkspace.region")}
        aria-hidden={!open ? true : undefined}
        inert={!open ? true : undefined}
        data-workbench-surface="right-workspace"
        data-workbench-glass-surface=""
        data-state={open ? "open" : "closed"}
        data-maximized={maximized ? "true" : undefined}
        className="bg-background absolute inset-y-0 right-0 flex min-h-0 min-w-0 flex-col overflow-hidden border-l transition-[transform,border-color] duration-(--layout-motion-duration) ease-(--layout-motion-ease) motion-reduce:transition-none in-data-[resizing=true]:transition-none in-data-[resizing=true]:will-change-[width,transform] data-[resizing=true]:transition-none data-[resizing=true]:will-change-[width,transform] data-[state=closed]:border-transparent"
        style={
          {
            width: "var(--right-workspace-content-width, var(--workbench-panel-width))",
            maxWidth: "100vw",
            transform: open
              ? maximized
                ? "translateX(0)"
                : "translateX(var(--right-workspace-resize-translate-x, 0px))"
              : "translateX(100%)",
          } as CSSProperties
        }
      >
        {open ? <WorkspaceHeader /> : null}
        <div
          className="relative min-h-0 flex-1 overflow-hidden"
          style={{ contentVisibility: open ? "visible" : "hidden" }}
        >
          <SurfaceHost isVisible={open} />
          {open ? <WorkspaceFeedbackLayer /> : null}
        </div>
        {presentation === "panel" ? (
          <WorkspaceResizeHandle
            width={width}
            workspaceRef={workspaceLayoutRef}
            onCommit={(nextWidth) => {
              captureWidth(nextWidth);
              controller.setWidth(nextWidth);
            }}
          />
        ) : null}
      </section>
    </div>
  );
}
