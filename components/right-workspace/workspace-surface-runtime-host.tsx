"use client";

import { useMemo } from "react";

import { ExtensionErrorBoundary, useExtensionErrorReporter } from "@/platform/extensions";

import type { WorkspaceContext } from "./core/surface-types";
import {
  RightWorkspaceReactContext,
  useRightWorkspaceEnvironment,
  useWorkspaceSurfaceDefinitions,
} from "./workspace-context";

export function WorkspaceSurfaceRuntimeHost({ context }: { context?: WorkspaceContext }) {
  const environment = useRightWorkspaceEnvironment();
  const definitions = useWorkspaceSurfaceDefinitions();
  const reportError = useExtensionErrorReporter();
  const runtimeEnvironment = useMemo(
    () => (context ? { ...environment, context } : environment),
    [context, environment],
  );

  const runtimes = definitions.flatMap((definition) => {
    const Runtime = definition.runtime;
    return Runtime
      ? [
          <ExtensionErrorBoundary
            key={definition.kind}
            contributionId={definition.kind}
            source="workspace"
            onError={reportError}
          >
            <Runtime />
          </ExtensionErrorBoundary>,
        ]
      : [];
  });

  return (
    <RightWorkspaceReactContext.Provider value={runtimeEnvironment}>
      {runtimes}
    </RightWorkspaceReactContext.Provider>
  );
}
