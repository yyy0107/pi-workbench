"use client";

import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";

import type { OpenerRegistry } from "@/platform/extensions";
import { DefaultOpenerService } from "@/services/opener-service";

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
  openers,
  registry,
}: Readonly<{
  children: ReactNode;
  openers: OpenerRegistry;
  registry: WorkspaceSurfaceRegistry;
}>) {
  const [store] = useState(createRightWorkspaceStore);
  const [feedback] = useState(() => new MemoryWorkspaceFeedbackStore());
  const controller = useMemo(
    () => new DefaultRightWorkspaceController(store, registry),
    [registry, store],
  );
  const opener = useMemo(
    () => new DefaultOpenerService(openers, controller),
    [controller, openers],
  );
  const [context, setContext] = useState<WorkspaceContext>(DEFAULT_CONTEXT);

  useLayoutEffect(() => {
    controller.hydrate(window.localStorage);
  }, [controller]);

  const value = useMemo<RightWorkspaceEnvironment>(
    () => ({
      controller,
      opener,
      store,
      registry,
      feedback,
      context,
      setContext,
    }),
    [context, controller, feedback, opener, registry, store],
  );

  return (
    <RightWorkspaceReactContext.Provider value={value}>
      {children}
    </RightWorkspaceReactContext.Provider>
  );
}
