"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { useI18n } from "@/i18n";

import {
  MAX_RIGHT_WORKSPACE_VIEWPORT_RATIO,
  MIN_RIGHT_WORKSPACE_WIDTH,
} from "./core/workspace-store";
import { WorkspaceFeedbackLayer } from "./feedback/feedback-layer";
import { SurfaceHost } from "./surface-host";
import { useRightWorkspaceState } from "./workspace-context";
import { WorkspaceHeader } from "./workspace-header";
import { WorkspaceResizeHandle } from "./workspace-resize-handle";

function viewportMaximum(): number {
  if (typeof window === "undefined") return 960;
  return Math.max(
    MIN_RIGHT_WORKSPACE_WIDTH,
    window.innerWidth * MAX_RIGHT_WORKSPACE_VIEWPORT_RATIO,
  );
}

export function RightWorkspace() {
  const { t } = useI18n();
  const open = useRightWorkspaceState((state) => state.open);
  const width = useRightWorkspaceState((state) => state.width);
  const maximized = useRightWorkspaceState((state) => state.maximized);
  const [maximum, setMaximum] = useState(viewportMaximum);
  const workspaceRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const update = () => setMaximum(viewportMaximum());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const renderedWidth = Math.min(maximum, width);

  return (
    <section
      ref={workspaceRef}
      id="right-workspace"
      aria-label={t("rightWorkspace.region")}
      aria-hidden={!open ? true : undefined}
      inert={!open ? true : undefined}
      data-workbench-surface="right-workspace"
      data-state={open ? "open" : "closed"}
      data-maximized={maximized ? "true" : undefined}
      className="bg-background relative flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-l transition-[width,border-color] duration-[240ms] ease-[cubic-bezier(0.45,0,0.8,0.7)] motion-reduce:transition-none data-[resizing=true]:transition-none data-[resizing=true]:will-change-[width] data-[state=closed]:pointer-events-none data-[state=closed]:border-transparent"
      style={
        {
          "--right-workspace-width": `${renderedWidth}px`,
          width: open ? (maximized ? "100%" : "min(var(--right-workspace-width), 100%)") : 0,
          maxWidth: "100%",
        } as CSSProperties
      }
    >
      <WorkspaceHeader />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <SurfaceHost />
        <WorkspaceFeedbackLayer />
      </div>
      {open && !maximized ? (
        <WorkspaceResizeHandle
          width={renderedWidth}
          maximum={maximum}
          workspaceRef={workspaceRef}
        />
      ) : null}
    </section>
  );
}
