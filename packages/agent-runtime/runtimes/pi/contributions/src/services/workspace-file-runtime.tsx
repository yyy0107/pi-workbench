"use client";

import { useMemo, type ReactNode } from "react";
import { usePiResourceClient } from "@workbench/agent-runtime-pi-client/resources";
import { WorkbenchWorkspaceFileRuntimeProvider } from "@workbench/shell/workspace-files";
import { createPiResourceFileBackend } from "./pi-resource-file-backend";

/** Only Pi resource discovery remains runtime-specific; workspace buffers belong to Shell. */
export function PiWorkspaceFileRuntimeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const client = usePiResourceClient();
  const resources = useMemo(() => createPiResourceFileBackend(client), [client]);
  return (
    <WorkbenchWorkspaceFileRuntimeProvider resources={resources}>
      {children}
    </WorkbenchWorkspaceFileRuntimeProvider>
  );
}
