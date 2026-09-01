import { createStore, type StoreApi } from "zustand/vanilla";

import type { WorkbenchWorkspaceDirectoryStorePort } from "@workbench/agent-runtime-client/workspaces";

export interface WorkspaceDirectoryState {
  collapsedDirectoryIds: readonly string[];
  activeDirectoryId?: string;
  draftDirectoryId?: string;
  reconcileDirectoryIds(ids: readonly string[], newlyAddedIds: readonly string[]): void;
  discardDirectory(id: string): void;
  activateDirectory(id: string): void;
  deactivateDirectory(): void;
  revealDirectory(id: string): void;
  setDirectoryCollapsed(id: string, collapsed: boolean): void;
  toggleDirectory(id: string): void;
  beginNewThread(id: string): void;
  destroyNewThread(): void;
}

function createWorkspaceDirectoryStore(): StoreApi<WorkspaceDirectoryState> {
  return createStore<WorkspaceDirectoryState>((set) => ({
    collapsedDirectoryIds: [],
    reconcileDirectoryIds: (ids, newlyAddedIds) =>
      set((state) => {
        const availableIds = new Set(ids);
        const draftDirectoryId =
          state.draftDirectoryId && availableIds.has(state.draftDirectoryId)
            ? state.draftDirectoryId
            : undefined;
        const activeDirectoryId =
          state.activeDirectoryId && availableIds.has(state.activeDirectoryId)
            ? state.activeDirectoryId
            : (draftDirectoryId ?? ids[0]);
        const activeDirectoryChanged = activeDirectoryId !== state.activeDirectoryId;
        const collapsedDirectoryIds = new Set(
          state.collapsedDirectoryIds.filter((id) => availableIds.has(id)),
        );
        for (const id of newlyAddedIds) {
          if (id !== activeDirectoryId && id !== draftDirectoryId) collapsedDirectoryIds.add(id);
        }
        if (activeDirectoryChanged && activeDirectoryId) {
          collapsedDirectoryIds.delete(activeDirectoryId);
        }

        return {
          activeDirectoryId,
          draftDirectoryId,
          collapsedDirectoryIds: [...collapsedDirectoryIds],
        };
      }),
    discardDirectory: (id) =>
      set((state) => ({
        collapsedDirectoryIds: state.collapsedDirectoryIds.filter(
          (directoryId) => directoryId !== id,
        ),
        activeDirectoryId: state.activeDirectoryId === id ? undefined : state.activeDirectoryId,
        draftDirectoryId: state.draftDirectoryId === id ? undefined : state.draftDirectoryId,
      })),
    activateDirectory: (id) => set({ activeDirectoryId: id }),
    deactivateDirectory: () => set({ activeDirectoryId: undefined, draftDirectoryId: undefined }),
    revealDirectory: (id) =>
      set((state) => ({
        activeDirectoryId: id,
        collapsedDirectoryIds: state.collapsedDirectoryIds.filter(
          (directoryId) => directoryId !== id,
        ),
      })),
    setDirectoryCollapsed: (id, collapsed) =>
      set((state) => {
        const currentlyCollapsed = state.collapsedDirectoryIds.includes(id);
        if (currentlyCollapsed === collapsed) return state;
        return {
          collapsedDirectoryIds: collapsed
            ? [...state.collapsedDirectoryIds, id]
            : state.collapsedDirectoryIds.filter((directoryId) => directoryId !== id),
        };
      }),
    toggleDirectory: (id) =>
      set((state) => ({
        collapsedDirectoryIds: state.collapsedDirectoryIds.includes(id)
          ? state.collapsedDirectoryIds.filter((directoryId) => directoryId !== id)
          : [...state.collapsedDirectoryIds, id],
      })),
    beginNewThread: (id) =>
      set((state) => ({
        activeDirectoryId: id,
        draftDirectoryId: id,
        collapsedDirectoryIds: state.collapsedDirectoryIds.filter(
          (directoryId) => directoryId !== id,
        ),
      })),
    destroyNewThread: () => set({ draftDirectoryId: undefined }),
  }));
}

export interface WorkspaceDirectoryStoreInstallation {
  readonly store: StoreApi<WorkspaceDirectoryState>;
  readonly port: WorkbenchWorkspaceDirectoryStorePort;
}

/** Create application-owned workspace selection state for one Workbench installation. */
export function createWorkspaceDirectoryStoreInstallation(): WorkspaceDirectoryStoreInstallation {
  const store = createWorkspaceDirectoryStore();
  const actions = Object.freeze({
    reconcileDirectoryIds: (ids, newlyAddedIds) =>
      store.getState().reconcileDirectoryIds(ids, newlyAddedIds),
    discardDirectory: (id) => store.getState().discardDirectory(id),
    activateDirectory: (id) => store.getState().activateDirectory(id),
    deactivateDirectory: () => store.getState().deactivateDirectory(),
    revealDirectory: (id) => store.getState().revealDirectory(id),
    setDirectoryCollapsed: (id, collapsed) => store.getState().setDirectoryCollapsed(id, collapsed),
    toggleDirectory: (id) => store.getState().toggleDirectory(id),
    beginNewThread: (id) => store.getState().beginNewThread(id),
    destroyNewThread: () => store.getState().destroyNewThread(),
  } satisfies WorkbenchWorkspaceDirectoryStorePort["actions"]);
  const port = Object.freeze<WorkbenchWorkspaceDirectoryStorePort>({
    getSnapshot: store.getState,
    subscribe: store.subscribe,
    actions,
  });
  return Object.freeze({ store, port });
}
