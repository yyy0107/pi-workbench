"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { MemoryFileDiffService, type FileDiffService } from "./file-diff-service";
import {
  BufferedFileWorkspaceService,
  type FileWorkspaceBackend,
  type FileWorkspaceService,
} from "./workspace-file-service";
import {
  usePiResourceClient,
  type PiResourceClient,
} from "@workbench/agent-runtime-pi-client/resources";
import { usePiWorkspaceClient } from "@workbench/agent-runtime-pi-client/workspace";

import { usePiRuntimeConnection } from "../public/runtime-connection-context";

export interface WorkspaceFileRuntime {
  readonly files: FileWorkspaceService;
  readonly resources: PiResourceClient;
  readonly diffs: FileDiffService;
}

const WorkspaceFileRuntimeContext = createContext<WorkspaceFileRuntime | null>(null);

export function WorkspaceFileRuntimeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const workspace = usePiWorkspaceClient();
  const resources = usePiResourceClient();
  const runtimeConnection = usePiRuntimeConnection();
  const backend = useMemo<FileWorkspaceBackend>(
    () => ({
      contentUrl: (payload) =>
        runtimeConnection.kind === "same-origin" ? workspace.fileContentUrl(payload) : undefined,
      listDirectory: workspace.listFiles,
      describeFile: workspace.describeFile,
      readFile: workspace.readFile,
      writeFile: workspace.writeFile,
      listSkillDirectory: resources.listSkillFiles,
      readSkillFile: resources.readSkillFile,
      listExtensionDirectory: resources.listExtensionFiles,
      readExtensionFile: resources.readExtensionFile,
    }),
    [resources, runtimeConnection.kind, workspace],
  );
  const runtime = useMemo<WorkspaceFileRuntime>(
    () =>
      Object.freeze({
        files: new BufferedFileWorkspaceService(backend),
        resources,
        diffs: new MemoryFileDiffService(),
      }),
    [backend, resources],
  );
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
