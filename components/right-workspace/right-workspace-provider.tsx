"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { DefaultRightWorkspaceController } from "./core/workspace-controller";
import type { WorkspaceContext, WorkspaceSurfaceRegistry } from "./core/surface-types";
import { createRightWorkspaceStore } from "./core/workspace-store";
import { MemoryWorkspaceFeedbackStore } from "./feedback/feedback-store";
import { RightWorkspaceReactContext, type RightWorkspaceEnvironment } from "./workspace-context";

const DEFAULT_CONTEXT: WorkspaceContext = {
  applicationId: "pi-workbench",
};

export function RightWorkspaceProvider({
  children,
  registry,
}: Readonly<{ children: ReactNode; registry: WorkspaceSurfaceRegistry }>) {
  const [store] = useState(createRightWorkspaceStore);
  const [feedback] = useState(() => new MemoryWorkspaceFeedbackStore());
  const [controller] = useState(() => new DefaultRightWorkspaceController(store, registry));
  const [context, setContext] = useState<WorkspaceContext>(DEFAULT_CONTEXT);

  useEffect(() => {
    controller.hydrate(window.localStorage);
  }, [controller]);

  const value = useMemo<RightWorkspaceEnvironment>(
    () => ({
      controller,
      store,
      registry,
      feedback,
      context,
      setContext,
    }),
    [context, controller, feedback, registry, store],
  );

  return (
    <RightWorkspaceReactContext.Provider value={value}>
      {children}
    </RightWorkspaceReactContext.Provider>
  );
}
