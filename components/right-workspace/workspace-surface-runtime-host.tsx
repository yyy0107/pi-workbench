"use client";

import { ExtensionErrorBoundary, useExtensionErrorReporter } from "@/platform/extensions";

import { useWorkspaceSurfaceDefinitions } from "./workspace-context";

export function WorkspaceSurfaceRuntimeHost() {
  const definitions = useWorkspaceSurfaceDefinitions();
  const reportError = useExtensionErrorReporter();

  return definitions.flatMap((definition) => {
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
}
