"use client";

import { lazy, useState, type ComponentType, type LazyExoticComponent } from "react";

import type { WorkspaceSurfaceProps } from "./api/workspace-surface";

export type WorkspaceSurfaceModule<P extends Record<string, unknown>> = Readonly<{
  default: ComponentType<WorkspaceSurfaceProps<P>>;
}>;

/**
 * Lazily load a Surface implementation without caching a rejected chunk forever.
 *
 * The returned wrapper creates its React.lazy component per mount. A Surface error-boundary retry
 * remounts the wrapper, so transient chunk failures execute the loader again.
 */
export function createLazyWorkspaceSurface<P extends Record<string, unknown>>(
  load: () => Promise<WorkspaceSurfaceModule<P>>,
): ComponentType<WorkspaceSurfaceProps<P>> {
  function LazyWorkspaceSurface(props: WorkspaceSurfaceProps<P>) {
    const [Surface] = useState<LazyExoticComponent<ComponentType<WorkspaceSurfaceProps<P>>>>(() =>
      lazy(load),
    );
    return <Surface {...props} />;
  }

  LazyWorkspaceSurface.displayName = "LazyWorkspaceSurface";
  return LazyWorkspaceSurface;
}
