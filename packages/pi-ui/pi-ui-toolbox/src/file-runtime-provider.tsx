"use client";
import { useMemo, type ReactNode } from "react";
import { usePiResourceClient } from "@workbench/pi-runtime-client/resources";
import { WorkbenchWorkspaceFileRuntimeProvider } from "@workbench/workspace-files";
import { createPiResourceFileBackend } from "./pi-resource-file-backend";

/**
 * Supplies only Pi Skill/Extension resources to Shell's capability-backed file runtime.
 */
export function PiAgentRuntimeContributionsProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const client = usePiResourceClient();
  const resources = useMemo(() => createPiResourceFileBackend(client), [client]);
  return (
    <WorkbenchWorkspaceFileRuntimeProvider resources={resources}>
      {children}
    </WorkbenchWorkspaceFileRuntimeProvider>
  );
}
