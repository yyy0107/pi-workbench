"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { useI18n } from "@/i18n";

import {
  DEFAULT_RIGHT_WORKSPACE_WIDTH,
  MAX_RIGHT_WORKSPACE_VIEWPORT_RATIO,
  MIN_RIGHT_WORKSPACE_WIDTH,
} from "./core/workspace-store";
import { WorkspaceFeedbackLayer } from "./feedback/feedback-layer";
import {
  MIN_CONVERSATION_WIDTH,
  resolveRightWorkspacePresentation,
} from "./right-workspace-layout";
import { SurfaceHost } from "./surface-host";
import { useRightWorkspaceState } from "./workspace-context";
import { WorkspaceHeader } from "./workspace-header";
import { WorkspaceResizeHandle } from "./workspace-resize-handle";

function workspaceMaximum(element: HTMLElement | null): number {
  if (typeof window === "undefined") return DEFAULT_RIGHT_WORKSPACE_WIDTH;
  const availableWidth = element?.parentElement?.clientWidth || window.innerWidth;
  return Math.max(
    MIN_RIGHT_WORKSPACE_WIDTH,
    Math.min(
      availableWidth * MAX_RIGHT_WORKSPACE_VIEWPORT_RATIO,
      availableWidth - MIN_CONVERSATION_WIDTH,
    ),
  );
}

export function RightWorkspace() {
  const { t } = useI18n();
  const open = useRightWorkspaceState((state) => state.open);
  const width = useRightWorkspaceState((state) => state.width);
  const maximized = useRightWorkspaceState((state) => state.maximized);
  const [maximum, setMaximum] = useState(DEFAULT_RIGHT_WORKSPACE_WIDTH);
  const workspaceLayoutRef = useRef<HTMLDivElement>(null);
  const presentation = resolveRightWorkspacePresentation(open, maximized);

  useLayoutEffect(() => {
    const update = () => setMaximum(workspaceMaximum(workspaceLayoutRef.current));
    update();
    window.addEventListener("resize", update);
    const parent = workspaceLayoutRef.current?.parentElement;
    const observer = parent ? new ResizeObserver(update) : undefined;
    if (parent) observer?.observe(parent);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const renderedWidth = Math.min(maximum, width);

  useLayoutEffect(() => {
    if (open) return;

    workspaceLayoutRef.current?.style.setProperty(
      "--right-workspace-layout-width",
      `${renderedWidth}px`,
    );
    workspaceLayoutRef.current?.style.setProperty(
      "--right-workspace-content-width",
      `${renderedWidth}px`,
    );
    workspaceLayoutRef.current?.style.setProperty("--right-workspace-resize-translate-x", "0px");
  }, [open, renderedWidth]);

  return (
    <div
      ref={workspaceLayoutRef}
      data-slot="right-workspace-layout"
      data-state={open ? "open" : "closed"}
      data-maximized={maximized ? "true" : undefined}
      className="relative h-full min-h-0 min-w-0 shrink-0 transition-[width] duration-[240ms] ease-[cubic-bezier(0.45,0,0.8,0.7)] motion-reduce:transition-none data-[resizing=true]:transition-none data-[resizing=true]:will-change-[width] data-[state=closed]:pointer-events-none"
      style={
        {
          "--right-workspace-layout-width": `${renderedWidth}px`,
          "--right-workspace-content-width": `${renderedWidth}px`,
          "--right-workspace-resize-translate-x": "0px",
          width:
            presentation === "closed"
              ? 0
              : presentation === "maximized"
                ? "100%"
                : "min(var(--right-workspace-layout-width), 100%)",
          maxWidth: "100%",
        } as CSSProperties
      }
    >
      <section
        id="right-workspace"
        aria-label={t("rightWorkspace.region")}
        aria-hidden={!open ? true : undefined}
        inert={!open ? true : undefined}
        data-workbench-surface="right-workspace"
        data-state={open ? "open" : "closed"}
        data-maximized={maximized ? "true" : undefined}
        className="bg-background absolute inset-y-0 right-0 flex min-h-0 min-w-0 flex-col overflow-hidden border-l transition-[width,transform,border-color] duration-[240ms] ease-[cubic-bezier(0.45,0,0.8,0.7)] motion-reduce:transition-none in-data-[resizing=true]:transition-none in-data-[resizing=true]:will-change-[width,transform] data-[resizing=true]:transition-none data-[resizing=true]:will-change-[width,transform] data-[state=closed]:border-transparent"
        style={
          {
            width:
              presentation === "maximized"
                ? "100%"
                : "min(var(--right-workspace-content-width), var(--right-workspace-layout-width), 100vw)",
            maxWidth: "100vw",
            transform: open
              ? maximized
                ? "translateX(0)"
                : "translateX(var(--right-workspace-resize-translate-x))"
              : "translateX(100%)",
          } as CSSProperties
        }
      >
        <WorkspaceHeader />
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <SurfaceHost />
          <WorkspaceFeedbackLayer />
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
