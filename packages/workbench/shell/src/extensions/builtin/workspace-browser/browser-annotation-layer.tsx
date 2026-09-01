"use client";

import { InlineFeedbackForm } from "../../../right-workspace/presentation";
import type { WorkspaceSurfaceInstance } from "@workbench/extension-sdk";

import type { BrowserSurfaceParams } from "./browser-surface";

export function BrowserAnnotationLayer({
  surface,
  label,
}: Readonly<{ surface: WorkspaceSurfaceInstance<BrowserSurfaceParams>; label: string }>) {
  return (
    <div className="absolute end-3 bottom-3">
      <InlineFeedbackForm
        surface={surface}
        kind="browser-element"
        label={label}
        target={{
          sessionId: surface.params.browserSessionId,
          url: surface.params.url ?? "about:blank",
          selector: "document",
        }}
      />
    </div>
  );
}
