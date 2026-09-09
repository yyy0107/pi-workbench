"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { useI18n } from "../../i18n";
import {
  DEFAULT_RIGHT_WORKSPACE_WIDTH,
  applyRightWorkspaceResizePreview,
  resolveRightWorkspacePresentation,
} from "../../right-workspace";
import { WorkspaceFeedbackLayer } from "./feedback/feedback-layer";
import { SurfaceHost } from "./surface-host";
import { useRightWorkspaceState } from "../../right-workspace-react";
import { WorkspaceHeader } from "./workspace-header";
import { WorkspaceResizeHandle } from "./workspace-resize-handle";
import { useWorkbenchDomIds } from "../../dom";
import { resolveRightWorkspaceMaximumWidth } from "../right-workspace-layout";

function workspaceMaximum(element: HTMLElement | null): number {
  if (typeof window === "undefined") return DEFAULT_RIGHT_WORKSPACE_WIDTH;
  const availableWidth = element?.parentElement?.getBoundingClientRect().width ?? window.innerWidth;
  return resolveRightWorkspaceMaximumWidth(availableWidth);
}

export function RightWorkspace({ isVisible = true }: { isVisible?: boolean }) {
  const { t } = useI18n();
  const domIds = useWorkbenchDomIds();
  const workspaceOpen = useRightWorkspaceState((state) => state.open);
  const open = isVisible && workspaceOpen;
  const width = useRightWorkspaceState((state) => state.width);
  const maximized = useRightWorkspaceState((state) => state.maximized);
  const [maximum, setMaximum] = useState(DEFAULT_RIGHT_WORKSPACE_WIDTH);
  const workspaceLayoutRef = useRef<HTMLDivElement>(null);
  const presentation = resolveRightWorkspacePresentation(open, maximized);

  useLayoutEffect(() => {
    const update = () => setMaximum(workspaceMaximum(workspaceLayoutRef.current));
    update();
    // The parent observer already covers native resizing, after layout is available.
    const parent = workspaceLayoutRef.current?.parentElement;
    const observer = parent ? new ResizeObserver(update) : undefined;
    if (parent) observer?.observe(parent);
    return () => {
      observer?.disconnect();
    };
  }, []);

  const renderedWidth = Math.min(maximum, width);

  useLayoutEffect(() => {
    if (workspaceLayoutRef.current?.dataset.resizing === "true") return;
    applyRightWorkspaceResizePreview(workspaceLayoutRef.current, renderedWidth);
  }, [open, renderedWidth]);

  return (
    <div
      ref={workspaceLayoutRef}
      data-slot="right-workspace-layout"
      data-state={open ? "open" : "closed"}
      data-maximized={maximized ? "true" : undefined}
      className="relative h-full min-h-0 min-w-0 shrink-0 transition-[width] duration-(--layout-motion-duration) ease-(--layout-motion-ease) motion-reduce:transition-none data-[resizing=true]:transition-none data-[resizing=true]:will-change-[width] data-[state=closed]:pointer-events-none"
      style={
        {
          width:
            presentation === "closed"
              ? 0
              : presentation === "maximized"
                ? "100%"
                : `min(var(--right-workspace-layout-width, ${renderedWidth}px), 100%)`,
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
        className="bg-background absolute inset-y-0 right-0 flex min-h-0 min-w-0 flex-col overflow-hidden border-l transition-[width,transform,border-color] duration-(--layout-motion-duration) ease-(--layout-motion-ease) motion-reduce:transition-none in-data-[resizing=true]:transition-none in-data-[resizing=true]:will-change-[width,transform] data-[resizing=true]:transition-none data-[resizing=true]:will-change-[width,transform] data-[state=closed]:border-transparent"
        style={
          {
            width:
              presentation === "maximized"
                ? "100%"
                : `min(var(--right-workspace-content-width, ${renderedWidth}px), 100vw)`,
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
            width={renderedWidth}
            maximum={maximum}
            workspaceRef={workspaceLayoutRef}
          />
        ) : null}
      </section>
    </div>
  );
}
