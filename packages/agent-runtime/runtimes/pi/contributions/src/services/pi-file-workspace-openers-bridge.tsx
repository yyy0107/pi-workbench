"use client";

import { useLayoutEffect, type ComponentType } from "react";

import {
  usePiResourceClient,
  type PiResourceClient,
} from "@workbench/agent-runtime-pi-client/resources";
import type { Disposable, OpenHandlerDefinition, OpenerRegistry } from "@workbench/extension-sdk";
import { useWorkbenchAssets } from "@workbench/shell/presentation";
import {
  useWorkspaceFileRuntime,
  type WorkspaceFileRuntime,
} from "@workbench/shell/workspace-files";

import { createFileOpenHandlers } from "../extensions/workspace-file/file-opener";
import { acquireFileViewerAssetBaseLease } from "./file-viewer-asset-base-lease";

type WorkspaceFileOpenHandlers = ReturnType<typeof createFileOpenHandlers>;
type WorkspaceFileOpenHandlerKey = keyof WorkspaceFileOpenHandlers;

const WORKSPACE_FILE_OPEN_HANDLER_IDS = Object.freeze({
  fileOpenHandler: "workspace.file",
  skillFileOpenHandler: "workspace.file.skill",
  skillDirectoryOpenHandler: "workspace.directory.skill",
  extensionFileOpenHandler: "workspace.file.extension",
  extensionDirectoryOpenHandler: "workspace.directory.extension",
}) satisfies Readonly<Record<WorkspaceFileOpenHandlerKey, string>>;

const WORKSPACE_FILE_OPEN_HANDLER_KEYS = Object.freeze(
  Object.keys(WORKSPACE_FILE_OPEN_HANDLER_IDS) as WorkspaceFileOpenHandlerKey[],
);

/**
 * Runtime binding captured by one Workspace File extension activation.
 *
 * Open handlers are registered synchronously by the extension while the React bridge supplies the
 * installation-local Pi services after commit. Keeping those two lifetimes separate ensures that
 * extension deactivation removes every handler before a replacement activation can begin.
 */
export interface WorkspaceFileOpenersBinding {
  connect(runtime: WorkspaceFileRuntime, resources: PiResourceClient): Disposable;
  getHandler(key: WorkspaceFileOpenHandlerKey): OpenHandlerDefinition | undefined;
}

export function createWorkspaceFileOpenersBinding(): WorkspaceFileOpenersBinding {
  const connections: { readonly handlers: WorkspaceFileOpenHandlers }[] = [];

  return Object.freeze({
    connect(runtime: WorkspaceFileRuntime, resources: PiResourceClient): Disposable {
      const connection = {
        handlers: createFileOpenHandlers(runtime.files, resources, runtime.diffs),
      };
      connections.push(connection);
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          const index = connections.indexOf(connection);
          if (index >= 0) connections.splice(index, 1);
        },
      };
    },
    getHandler(key: WorkspaceFileOpenHandlerKey) {
      return connections.at(-1)?.handlers[key];
    },
  });
}

/** Register every Workspace File resource scheme as one transactional lifecycle unit. */
export function registerWorkspaceFileOpeners(
  openers: OpenerRegistry,
  binding: WorkspaceFileOpenersBinding,
): Disposable {
  const registrations: Disposable[] = [];
  let disposed = false;

  try {
    for (const key of WORKSPACE_FILE_OPEN_HANDLER_KEYS) {
      registrations.push(
        openers.register({
          id: WORKSPACE_FILE_OPEN_HANDLER_IDS[key],
          canOpen(request) {
            return binding.getHandler(key)?.canOpen(request) ?? 0;
          },
          open(request, context) {
            const handler = binding.getHandler(key);
            if (!handler) {
              throw new Error("Workspace File runtime is not mounted");
            }
            return handler.open(request, context);
          },
        }),
      );
    }
  } catch (error) {
    for (const registration of registrations.reverse()) registration.dispose();
    throw error;
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const registration of registrations.reverse()) registration.dispose();
    },
  };
}

/** Creates the mount-only contribution that supplies Pi services to one extension activation. */
export function createWorkspaceFileOpenersContribution(
  binding: WorkspaceFileOpenersBinding,
): ComponentType<Record<never, never>> {
  return function WorkspaceFileOpenersContribution() {
    const { fileViewerAssetBaseUrl } = useWorkbenchAssets();
    const resources = usePiResourceClient();
    const runtime = useWorkspaceFileRuntime();

    useLayoutEffect(
      () => acquireFileViewerAssetBaseLease(fileViewerAssetBaseUrl),
      [fileViewerAssetBaseUrl],
    );

    useLayoutEffect(() => {
      const connection = binding.connect(runtime, resources);
      return () => connection.dispose();
    }, [binding, resources, runtime]);

    return null;
  };
}
