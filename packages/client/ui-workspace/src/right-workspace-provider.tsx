"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { WorkspaceContext, WorkspaceSurfaceRegistry } from "@workbench/extension-sdk";
import {
  createRightWorkspaceInstallation,
  type LocalizableTextValidator,
  type RightWorkspaceDraftPersistencePort,
  type RightWorkspaceInstallationInputs,
  type RightWorkspaceOpenerFactory,
  type RightWorkspacePersistencePort,
} from "@workbench/workspace-runtime";

import {
  RightWorkspaceReactContext,
  type RightWorkspaceEnvironment,
} from "./right-workspace-context";

/**
 * Pure construction callback for one candidate installation. React development Strict Mode may
 * probe the Provider initializer more than once, so this callback must not subscribe or allocate
 * externally owned resources. Only the committed installation receives lifecycle guarantees.
 */
export type { RightWorkspaceOpenerFactory } from "@workbench/workspace-runtime";

/**
 * Every prop other than children is an immutable installation input. To replace one, remount this
 * Provider with a different React key; an ordinary same-key rerender deliberately keeps the first
 * controller, store, feedback store, opener, registry, persistence ports, validator, and context.
 */
export interface RightWorkspaceProviderProps {
  readonly children: ReactNode;
  readonly createOpener: RightWorkspaceOpenerFactory;
  readonly draftPersistence?: RightWorkspaceDraftPersistencePort;
  readonly initialContext: WorkspaceContext;
  readonly persistence?: RightWorkspacePersistencePort;
  readonly registry: WorkspaceSurfaceRegistry;
  readonly validateLocalizableText: LocalizableTextValidator;
}

interface DisposableRightWorkspaceResource {
  dispose(): void;
}

function isDisposableResource(value: unknown): value is DisposableRightWorkspaceResource {
  return (
    typeof value === "object" &&
    value !== null &&
    "dispose" in value &&
    typeof value.dispose === "function"
  );
}

function createPresentationResources() {
  const resources = new Map<symbol, unknown>();
  let resourcesDisposed = false;
  const resolveResource = <T,>(key: symbol, create: () => T): T => {
    if (resourcesDisposed) {
      throw new Error("The RightWorkspace installation resource owner has been disposed.");
    }
    if (!resources.has(key)) resources.set(key, create());
    return resources.get(key) as T;
  };
  const disposeResources = () => {
    if (resourcesDisposed) return;
    resourcesDisposed = true;
    for (const resource of resources.values()) {
      if (!isDisposableResource(resource)) continue;
      try {
        resource.dispose();
      } catch (error) {
        console.error("[workbench] failed to dispose a workspace presentation resource", error);
      }
    }
    resources.clear();
  };

  return Object.freeze({ resolveResource, disposeResources });
}

function sameInstallationInputs(
  installed: RightWorkspaceInstallationInputs,
  current: RightWorkspaceInstallationInputs,
): boolean {
  return (
    installed.createOpener === current.createOpener &&
    installed.draftPersistence === current.draftPersistence &&
    installed.initialContext === current.initialContext &&
    installed.persistence === current.persistence &&
    installed.registry === current.registry &&
    installed.validateLocalizableText === current.validateLocalizableText
  );
}

export function RightWorkspaceProvider({
  children,
  createOpener,
  draftPersistence,
  initialContext,
  persistence,
  registry,
  validateLocalizableText,
}: RightWorkspaceProviderProps) {
  const currentInputs: RightWorkspaceInstallationInputs = {
    createOpener,
    draftPersistence,
    initialContext,
    persistence,
    registry,
    validateLocalizableText,
  };
  const [installation] = useState(() => createRightWorkspaceInstallation(currentInputs));
  const [presentationResources] = useState(createPresentationResources);
  const { controller, feedback, opener, store } = installation;
  const [context, setContext] = useState<WorkspaceContext>(() => ({
    ...installation.initialContext,
  }));
  const lifecycleGeneration = useRef(0);
  const reportedImmutableInputChange = useRef(false);

  useLayoutEffect(() => {
    if (
      reportedImmutableInputChange.current ||
      sameInstallationInputs(installation.inputs, currentInputs)
    ) {
      return;
    }
    reportedImmutableInputChange.current = true;
    console.error(
      "RightWorkspaceProvider installation inputs are immutable; remount it with a new React key to replace them.",
    );
  }, [
    createOpener,
    draftPersistence,
    initialContext,
    installation,
    persistence,
    registry,
    validateLocalizableText,
  ]);

  useLayoutEffect(() => {
    const generation = ++lifecycleGeneration.current;
    installation.activatePersistence();
    void controller.initialize();

    return () => {
      installation.deactivatePersistence();
      queueMicrotask(() => {
        // Strict Effects immediately replay setup with a newer generation. A real unmount or
        // keyed replacement has no replay for this immutable installation and owns disposal.
        if (lifecycleGeneration.current !== generation) return;
        presentationResources.disposeResources();
        installation.dispose();
      });
    };
  }, [controller, installation, presentationResources]);

  const value = useMemo<RightWorkspaceEnvironment>(
    () => ({
      controller,
      opener,
      store,
      registry: installation.registry,
      feedback,
      context,
      setContext,
      resolveInstallationResource: presentationResources.resolveResource,
      draftStore: installation.resolveDraftStore(),
    }),
    [context, controller, feedback, installation, opener, presentationResources, store],
  );

  return (
    <RightWorkspaceReactContext.Provider value={value}>
      {children}
    </RightWorkspaceReactContext.Provider>
  );
}
