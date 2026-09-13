"use client";

import { useRightWorkspaceEnvironment } from "./right-workspace-context";

/** App-owned key/value persistence scoped to one immutable RightWorkspace installation. */
export interface RightWorkspaceDraftPersistencePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Installation-local draft storage shared by generic and package-owned workspace surfaces. */
export interface WorkspaceDraftStore extends RightWorkspaceDraftPersistencePort {}

interface DisposableWorkspaceDraftStore extends WorkspaceDraftStore {
  dispose(): void;
}

function snapshotPersistencePort(
  persistence: RightWorkspaceDraftPersistencePort | undefined,
): RightWorkspaceDraftPersistencePort | undefined {
  if (!persistence) return undefined;
  const getItem = persistence.getItem.bind(persistence);
  const setItem = persistence.setItem.bind(persistence);
  const removeItem = persistence.removeItem.bind(persistence);
  return Object.freeze({
    getItem: (key: string) => getItem(key),
    setItem: (key: string, value: string) => setItem(key, value),
    removeItem: (key: string) => removeItem(key),
  });
}

export function createWorkspaceDraftStore(
  persistenceInput?: RightWorkspaceDraftPersistencePort,
): DisposableWorkspaceDraftStore {
  const persistence = snapshotPersistencePort(persistenceInput);
  const loadedKeys = new Set<string>();
  const values = new Map<string, string>();
  let disposed = false;

  return Object.freeze({
    getItem(key: string): string | null {
      if (disposed) return null;
      if (!loadedKeys.has(key)) {
        loadedKeys.add(key);
        try {
          const persisted = persistence?.getItem(key);
          if (typeof persisted === "string") values.set(key, persisted);
        } catch {
          // Draft persistence is an enhancement; this installation's memory remains available.
        }
      }
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      if (disposed) return;
      loadedKeys.add(key);
      values.set(key, value);
      try {
        persistence?.setItem(key, value);
      } catch {
        // Keep the installation-local draft when the application port is unavailable.
      }
    },
    removeItem(key: string): void {
      if (disposed) return;
      loadedKeys.add(key);
      values.delete(key);
      try {
        persistence?.removeItem(key);
      } catch {
        // Removing the in-memory value is still authoritative for this installation.
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      loadedKeys.clear();
      values.clear();
    },
  });
}

const WORKSPACE_DRAFT_STORE_RESOURCE = Symbol("workbench.workspace-draft-store");

export function useWorkspaceDraftStore(): WorkspaceDraftStore {
  const environment = useRightWorkspaceEnvironment();
  return environment.resolveInstallationResource(WORKSPACE_DRAFT_STORE_RESOURCE, () =>
    createWorkspaceDraftStore(environment.draftPersistence),
  );
}
