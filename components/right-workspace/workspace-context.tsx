"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import { useStore } from "zustand";

import type { RightWorkspaceController } from "./core/workspace-controller";
import type {
  AnyWorkspaceSurfaceDefinition,
  RightWorkspaceState,
  WorkspaceContext,
  WorkspaceSurfaceRegistry,
} from "./core/surface-types";
import type { RightWorkspaceStoreApi } from "./core/workspace-store";
import type { WorkspaceFeedbackSnapshot, WorkspaceFeedbackStore } from "./feedback/feedback-store";

export interface RightWorkspaceEnvironment {
  controller: RightWorkspaceController;
  store: RightWorkspaceStoreApi;
  registry: WorkspaceSurfaceRegistry;
  feedback: WorkspaceFeedbackStore;
  context: WorkspaceContext;
  setContext(context: WorkspaceContext): void;
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

export function useRightWorkspaceState<T>(selector: (state: RightWorkspaceState) => T): T {
  return useStore(useRightWorkspaceEnvironment().store, selector);
}

export function useWorkspaceContext(): WorkspaceContext {
  return useRightWorkspaceEnvironment().context;
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
