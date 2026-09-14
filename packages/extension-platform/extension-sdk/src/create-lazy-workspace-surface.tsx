"use client";

import { lazy, type ComponentType, type LazyExoticComponent } from "react";

import type { WorkspaceSurfaceProps } from "./api/workspace-surface";

export type WorkspaceSurfaceModule<P extends Record<string, unknown>> = Readonly<{
  default: ComponentType<WorkspaceSurfaceProps<P>>;
}>;

/**
 * Lazily load a Surface implementation without caching a rejected chunk forever.
 *
 * Keep lazy identities outside render: React discards hook state when an initial mount suspends.
 * The host advances loadRetryToken on an error-boundary retry to request a fresh loading attempt.
 */
export function createLazyWorkspaceSurface<P extends Record<string, unknown>>(
  load: () => Promise<WorkspaceSurfaceModule<P>>,
): ComponentType<WorkspaceSurfaceProps<P>> {
  type SurfaceComponent = ComponentType<WorkspaceSurfaceProps<P>>;
  let resolved: SurfaceComponent | undefined;
  const retries = new Map<string, LazyExoticComponent<SurfaceComponent>>();
  const createAttempt = () =>
    lazy(async () => {
      const module = await load();
      resolved = module.default;
      retries.clear();
      return module;
    });
  const initialAttempt = createAttempt();

  function LazyWorkspaceSurface(props: WorkspaceSurfaceProps<P>) {
    // Once loaded, new files and remounted tabs can render synchronously.
    if (resolved) {
      const Surface = resolved;
      return <Surface {...props} />;
    }
    let Surface = initialAttempt;
    if (props.loadRetryToken) {
      const key = JSON.stringify([props.surface.id, props.loadRetryToken]);
      const existing = retries.get(key);
      Surface = existing ?? createAttempt();
      if (!existing) retries.set(key, Surface);
    }
    return <Surface {...props} />;
  }

  LazyWorkspaceSurface.displayName = "LazyWorkspaceSurface";
  return LazyWorkspaceSurface;
}
