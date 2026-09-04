"use client";

import { useMemo, type ReactNode } from "react";

import { usePiResourceClient } from "@workbench/agent-runtime-pi-client/resources";
import { usePiWorkspaceClient } from "@workbench/agent-runtime-pi-client/workspace";
import { useRuntimeConnection } from "@workbench/shell/runtime-connection";
import {
  MemoryFileDiffService,
  WorkspaceFileRuntimeProvider,
  type WorkspaceFileRuntime,
} from "@workbench/shell/workspace-files";

import { BufferedFileWorkspaceService, type FileWorkspaceBackend } from "./workspace-file-service";

export function PiWorkspaceFileRuntimeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const workspace = usePiWorkspaceClient();
  const resources = usePiResourceClient();
  const runtimeConnection = useRuntimeConnection();
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
        diffs: new MemoryFileDiffService(),
      }),
    [backend],
  );
  return <WorkspaceFileRuntimeProvider runtime={runtime}>{children}</WorkspaceFileRuntimeProvider>;
}
