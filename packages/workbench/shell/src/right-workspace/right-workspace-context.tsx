"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type {
  AnyWorkspaceSurfaceDefinition,
  OpenerService,
  WorkspaceContext,
  WorkspaceSurfaceInstance,
  WorkspaceSurfaceRegistry,
} from "@workbench/extension-sdk";

import { selectActiveSurface, selectContextSurfaces } from "./workspace-selectors";
import type { RightWorkspaceController } from "./workspace-controller";
import type { WorkspaceFeedbackSnapshot, WorkspaceFeedbackStore } from "./workspace-feedback-store";
import type { RightWorkspaceState } from "./surface-types";
import type { RightWorkspaceStoreApi } from "./workspace-store";
import type { RightWorkspaceDraftPersistencePort } from "./workspace-draft-store";

export type RightWorkspaceStateStore = Pick<
  RightWorkspaceStoreApi,
  "getInitialState" | "getState" | "subscribe"
>;

export interface RightWorkspaceEnvironment {
  readonly controller: RightWorkspaceController;
  readonly opener: OpenerService;
  readonly store: RightWorkspaceStateStore;
  readonly registry: WorkspaceSurfaceRegistry;
  readonly feedback: WorkspaceFeedbackStore;
  readonly context: WorkspaceContext;
  readonly setContext: (context: WorkspaceContext) => void;
  readonly resolveInstallationResource: <T>(key: symbol, create: () => T) => T;
  readonly draftPersistence?: RightWorkspaceDraftPersistencePort;
}

export const RightWorkspaceReactContext = createContext<RightWorkspaceEnvironment | null>(null);

export function useRightWorkspaceEnvironment(): RightWorkspaceEnvironment {
  const environment = useContext(RightWorkspaceReactContext);
  if (!environment) throw new Error("RightWorkspaceProvider is missing");
  return environment;
}

export function useRightWorkspace(): RightWorkspaceController {
  return useRightWorkspaceEnvironment().controller;
}

export function useOpenerService(): OpenerService {
  return useRightWorkspaceEnvironment().opener;
}

export function useRightWorkspaceState<T>(selector: (state: RightWorkspaceState) => T): T {
  return useStore(useRightWorkspaceEnvironment().store, selector);
}

export function useWorkspaceContext(): WorkspaceContext {
  return useRightWorkspaceEnvironment().context;
}

export function useWorkspaceSurfaces(kind: string): readonly WorkspaceSurfaceInstance[] {
  const context = useWorkspaceContext();
  return useRightWorkspaceState(
    useShallow((state) =>
      selectContextSurfaces(state, context).filter((surface) => surface.kind === kind),
    ),
  );
}

export function useActiveWorkspaceSurface(): WorkspaceSurfaceInstance | undefined {
  const context = useWorkspaceContext();
  return useRightWorkspaceState((state) => selectActiveSurface(state, context));
}

export function useWorkspaceOpen(): boolean {
  return useRightWorkspaceState((state) => state.open);
}

export function useSetWorkspaceContext(): (context: WorkspaceContext) => void {
  return useRightWorkspaceEnvironment().setContext;
}

const EMPTY_SURFACE_DEFINITIONS = Object.freeze([]) as readonly AnyWorkspaceSurfaceDefinition[];

export function useWorkspaceSurfaceDefinitions(): readonly AnyWorkspaceSurfaceDefinition[] {
  const registry = useRightWorkspaceEnvironment().registry;
  const getSnapshot = useCallback(() => registry.getAll(), [registry]);
  return useSyncExternalStore(registry.subscribe, getSnapshot, () => EMPTY_SURFACE_DEFINITIONS);
}

export function useWorkspaceFeedbackStore(): WorkspaceFeedbackStore {
  return useRightWorkspaceEnvironment().feedback;
}

/** Package-private lazy resource owner shared by runtime bridges and surfaces in one installation. */
export function useRightWorkspaceInstallationResource<T>(key: symbol, create: () => T): T {
  return useRightWorkspaceEnvironment().resolveInstallationResource(key, create);
}

export function useWorkspaceFeedbackState<T>(
  selector: (snapshot: WorkspaceFeedbackSnapshot) => T,
): T {
  const feedback = useWorkspaceFeedbackStore();
  const snapshot = useSyncExternalStore(
    feedback.subscribe,
    feedback.getSnapshot,
    feedback.getSnapshot,
  );
  return selector(snapshot);
}
