"use client";

import { useMemo, useRef } from "react";

import { ExtensionErrorBoundary } from "@workbench/extension-host/hosts/extension-error-boundary";
import type { WorkspaceContext } from "@workbench/extension-sdk";

import {
  RightWorkspaceReactContext,
  useRightWorkspaceEnvironment,
  useWorkspaceSurfaceDefinitions,
} from "./right-workspace-context";

export interface WorkspaceRuntimeErrorDetails {
  readonly source: "workspace";
  readonly contributionId?: string;
  readonly componentStack?: string | null;
}

export type WorkspaceRuntimeErrorReporter = (
  error: unknown,
  details: WorkspaceRuntimeErrorDetails,
) => void;

export interface WorkspaceSurfaceRuntimeHostProps {
  readonly context?: WorkspaceContext;
  readonly reportError: WorkspaceRuntimeErrorReporter;
}

export function WorkspaceSurfaceRuntimeHost({
  context,
  reportError,
}: WorkspaceSurfaceRuntimeHostProps) {
  const environment = useRightWorkspaceEnvironment();
  const definitions = useWorkspaceSurfaceDefinitions();
  const registrationIds = useRef(new WeakMap<object, number>());
  const nextRegistrationId = useRef(0);
  const runtimeEnvironment = useMemo(
    () => (context ? { ...environment, context } : environment),
    [context, environment],
  );

  const runtimes = definitions.flatMap((definition) => {
    const Runtime = definition.runtime;
    let registrationId = registrationIds.current.get(definition);
    if (registrationId === undefined) {
      registrationId = ++nextRegistrationId.current;
      registrationIds.current.set(definition, registrationId);
    }
    return Runtime
      ? [
          <ExtensionErrorBoundary
            key={`${definition.kind}:${registrationId}`}
            contributionId={definition.kind}
            source="workspace"
            resetKey={definition}
            onError={(error, details) =>
              reportError(error, {
                source: "workspace",
                contributionId: details.contributionId,
                componentStack: details.componentStack,
              })
            }
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
