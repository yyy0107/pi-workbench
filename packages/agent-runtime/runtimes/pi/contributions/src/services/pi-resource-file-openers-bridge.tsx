"use client";

import { useLayoutEffect, type ComponentType } from "react";

import {
  usePiResourceClient,
  type PiResourceClient,
} from "@workbench/agent-runtime-pi-client/resources";
import {
  createDisposable,
  disposeAll,
  type Disposable,
  type OpenHandlerDefinition,
  type OpenerRegistry,
  type WorkspaceSurfaceRegistry,
} from "@workbench/extension-sdk";
import {
  useWorkspaceFileRuntime,
  type WorkspaceFileRuntime,
} from "@workbench/shell/workspace-files";

import { createPiResourceFileOpenHandlers } from "./pi-resource-file-openers";

type PiResourceFileOpenHandlers = ReturnType<typeof createPiResourceFileOpenHandlers>;
type PiResourceFileOpenHandlerKey = keyof PiResourceFileOpenHandlers;

const PI_RESOURCE_FILE_OPEN_HANDLER_IDS = Object.freeze({
  skillFileOpenHandler: "workspace.file.skill",
  skillDirectoryOpenHandler: "workspace.directory.skill",
  extensionFileOpenHandler: "workspace.file.extension",
  extensionDirectoryOpenHandler: "workspace.directory.extension",
}) satisfies Readonly<Record<PiResourceFileOpenHandlerKey, string>>;

const PI_RESOURCE_FILE_OPEN_HANDLER_KEYS = Object.freeze(
  Object.keys(PI_RESOURCE_FILE_OPEN_HANDLER_IDS) as PiResourceFileOpenHandlerKey[],
);

/**
 * Runtime binding captured by one Pi Toolbox extension activation.
 *
 * Open handlers are registered synchronously by the extension while the React bridge supplies the
 * installation-local Pi services after commit. Keeping those two lifetimes separate ensures that
 * extension deactivation removes every handler before a replacement activation can begin.
 */
export interface PiResourceFileOpenersBinding {
  connect(runtime: WorkspaceFileRuntime, resources: PiResourceClient): Disposable;
  getHandler(key: PiResourceFileOpenHandlerKey): OpenHandlerDefinition | undefined;
}

export function createPiResourceFileOpenersBinding(): PiResourceFileOpenersBinding {
  const connections: { readonly handlers: PiResourceFileOpenHandlers }[] = [];

  return Object.freeze({
    connect(runtime: WorkspaceFileRuntime, resources: PiResourceClient): Disposable {
      const connection = {
        handlers: createPiResourceFileOpenHandlers(runtime.files, resources),
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
    getHandler(key: PiResourceFileOpenHandlerKey) {
      return connections.at(-1)?.handlers[key];
    },
  });
}

/** Register Pi resource file schemes only while their Shell file surface is installed. */
export function registerPiResourceFileOpeners(
  openers: OpenerRegistry,
  binding: PiResourceFileOpenersBinding,
  workspace: WorkspaceSurfaceRegistry,
): Disposable {
  const registrations: Disposable[] = [];

  const synchronize = () => {
    if (!workspace.get("file")) {
      disposeAll(registrations.splice(0));
      return;
    }
    if (registrations.length) return;

    try {
      for (const key of PI_RESOURCE_FILE_OPEN_HANDLER_KEYS) {
        registrations.push(
          openers.register({
            id: PI_RESOURCE_FILE_OPEN_HANDLER_IDS[key],
            canOpen(request) {
              return workspace.get("file") ? (binding.getHandler(key)?.canOpen(request) ?? 0) : 0;
            },
            open(request, context) {
              const handler = workspace.get("file") ? binding.getHandler(key) : undefined;
              if (!handler) {
                throw new Error("Workspace File runtime is not mounted");
              }
              return handler.open(request, context);
            },
          }),
        );
      }
    } catch (error) {
      disposeAll(registrations.splice(0));
      throw error;
    }
  };
  synchronize();
  const unsubscribe = workspace.subscribe(synchronize);
  return createDisposable(() => {
    unsubscribe();
    disposeAll(registrations.splice(0));
  });
}

/** Creates the mount-only contribution that supplies Pi services to one extension activation. */
export function createPiResourceFileOpenersContribution(
  binding: PiResourceFileOpenersBinding,
): ComponentType<Record<never, never>> {
  return function PiResourceFileOpenersContribution() {
    const resources = usePiResourceClient();
    const runtime = useWorkspaceFileRuntime();

    useLayoutEffect(() => {
      const connection = binding.connect(runtime, resources);
      return () => connection.dispose();
    }, [binding, resources, runtime]);

    return null;
  };
}
