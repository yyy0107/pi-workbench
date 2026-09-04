"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useWorkbenchWorkspaceCapability } from "@workbench/agent-runtime-client/context";
import { useRuntimeConnection } from "../runtime-connection";
import {
  BufferedFileWorkspaceService,
  type FileWorkspaceResourceBackend,
} from "./buffered-file-workspace-service";

import { MemoryFileDiffService, type FileDiffService } from "./file-diff-service";
import type { FileWorkspaceService } from "./workspace-file-service";

export interface WorkspaceFileRuntime {
  readonly files: FileWorkspaceService;
  readonly diffs: FileDiffService;
}

const WorkspaceFileRuntimeContext = createContext<WorkspaceFileRuntime | null>(null);

/** Generic buffers use the active capability; runtime-specific resources are optional inputs. */
export function WorkbenchWorkspaceFileRuntimeProvider({
  children,
  resources,
}: Readonly<{ children: ReactNode; resources?: FileWorkspaceResourceBackend }>) {
  const workspace = useWorkbenchWorkspaceCapability();
  const connection = useRuntimeConnection();
  const runtime = useMemo<WorkspaceFileRuntime>(
    () =>
      Object.freeze({
        files: new BufferedFileWorkspaceService(
          workspace
            ? {
                contentUrl: (request) =>
                  connection.kind === "same-origin" ? workspace.fileContentUrl(request) : undefined,
                listDirectory: workspace.listFiles,
                describeFile: workspace.describeFile,
                readFile: workspace.readFile,
                writeFile: workspace.writeFile,
              }
            : undefined,
          resources,
        ),
        diffs: new MemoryFileDiffService(),
      }),
    [connection.kind, resources, workspace],
  );
  return <WorkspaceFileRuntimeProvider runtime={runtime}>{children}</WorkspaceFileRuntimeProvider>;
}

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
