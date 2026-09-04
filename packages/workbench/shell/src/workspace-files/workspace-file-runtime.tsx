"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { FileDiffService } from "./file-diff-service";
import type { FileWorkspaceService } from "./workspace-file-service";

export interface WorkspaceFileRuntime {
  readonly files: FileWorkspaceService;
  readonly diffs: FileDiffService;
}

const WorkspaceFileRuntimeContext = createContext<WorkspaceFileRuntime | null>(null);

export function WorkspaceFileRuntimeProvider({
  children,
  runtime,
}: Readonly<{ children: ReactNode; runtime: WorkspaceFileRuntime }>) {
  return (
    <WorkspaceFileRuntimeContext.Provider value={runtime}>
      {children}
    </WorkspaceFileRuntimeContext.Provider>
  );
}

export function useWorkspaceFileRuntime(): WorkspaceFileRuntime {
  const runtime = useContext(WorkspaceFileRuntimeContext);
  if (!runtime) throw new Error("WorkspaceFileRuntimeProvider is missing");
  return runtime;
}
