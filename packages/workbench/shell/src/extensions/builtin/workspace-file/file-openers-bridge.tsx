"use client";

import { useLayoutEffect } from "react";
import {
  useWorkbenchRuntimeHostCapability,
  useWorkbenchWorkspaceCapability,
} from "@workbench/agent-runtime-client/context";
import type { Disposable, OpenHandlerDefinition, OpenerRegistry } from "@workbench/extension-sdk";
import { useWorkbenchAssets } from "@workbench/shell/presentation";
import {
  useWorkspaceFileRuntime,
  type WorkspaceFileRuntime,
} from "@workbench/shell/workspace-files";
import { acquireFileViewerAssetBaseLease } from "../../../workspace-files/file-viewer-asset-base-lease";
import { createFileOpenHandler } from "./file-opener";

export function createWorkspaceFileOpenersBinding() {
  const handlers: OpenHandlerDefinition[] = [];
  return {
    connect(runtime: WorkspaceFileRuntime): Disposable {
      const handler = createFileOpenHandler(runtime.files, runtime.diffs);
      handlers.push(handler);
      return {
        dispose() {
          const index = handlers.indexOf(handler);
          if (index >= 0) handlers.splice(index, 1);
        },
      };
    },
    getHandler: () => handlers.at(-1),
  };
}

type WorkspaceFileOpenersBinding = ReturnType<typeof createWorkspaceFileOpenersBinding>;

export function registerWorkspaceFileOpeners(
  openers: OpenerRegistry,
  binding: WorkspaceFileOpenersBinding,
): Disposable {
  return openers.register({
    id: "workspace.file",
    canOpen: (request) => binding.getHandler()?.canOpen(request) ?? 0,
    open(request, context) {
      const handler = binding.getHandler();
      if (!handler) throw new Error("Workspace File runtime is not mounted");
      return handler.open(request, context);
    },
  });
}

export function createWorkspaceFileOpenersContribution(binding: WorkspaceFileOpenersBinding) {
  return function WorkspaceFileOpenersContribution() {
    const { fileViewerAssetBaseUrl } = useWorkbenchAssets();
    const workspace = useWorkbenchWorkspaceCapability();
    const localFiles = useWorkbenchRuntimeHostCapability()?.files;
    const runtime = useWorkspaceFileRuntime();
    useLayoutEffect(
      () => acquireFileViewerAssetBaseLease(fileViewerAssetBaseUrl),
      [fileViewerAssetBaseUrl],
    );
    useLayoutEffect(() => {
      if (!workspace && !localFiles) return;
      const connection = binding.connect(runtime);
      return () => connection.dispose();
    }, [localFiles, runtime, workspace]);
    return null;
  };
}
