import { createStore, type StoreApi } from "zustand/vanilla";

import type { WorkbenchSettingsPort } from "@workbench/agent-runtime-contracts/settings";
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

function createWorkspaceDirectoryStore(settings?: WorkbenchSettingsPort): {
  readonly store: StoreApi<WorkspaceDirectoryState>;
  hydrate(): Promise<void>;
} {
  let knownDirectoryIds: readonly string[] = [];
  let expandedDirectoryIds: Set<string> | undefined;
  let hydrated = false;
  let hydrationTask: Promise<void> | undefined;
  let localRevision = 0;
  let persistenceTail = Promise.resolve();
  let store: StoreApi<WorkspaceDirectoryState>;

  const expandedIdsFromState = () => {
    const collapsed = new Set(store.getState().collapsedDirectoryIds);
    return new Set(knownDirectoryIds.filter((id) => !collapsed.has(id)));
  };
  const persistExpandedIds = () => {
    if (!settings || !hydrated) return;
    const value = [...(expandedDirectoryIds ?? expandedIdsFromState())];
    const operation = () => settings.update({ sidebarExpandedWorkspaceIds: value });
    const result = persistenceTail.then(operation, operation);
    persistenceTail = result.catch(() => undefined);
    void result.catch((error) =>
      console.error("[workbench] failed to persist sidebar workspace expansion", error),
    );
  };
  const recordExpanded = (id: string, expanded: boolean) => {
    if (!hydrated) return;
    expandedDirectoryIds ??= expandedIdsFromState();
    if (expanded) expandedDirectoryIds.add(id);
    else expandedDirectoryIds.delete(id);
    persistExpandedIds();
  };
  const hydrate = () => {
    if (hydrated || !settings) {
      hydrated = true;
      return Promise.resolve();
    }
    hydrationTask ??= settings
      .load()
      .then((preferences) => {
        const persisted = preferences.sidebarExpandedWorkspaceIds;
        if (localRevision === 0 && persisted !== undefined) {
          expandedDirectoryIds = new Set(persisted);
          store.setState({
            collapsedDirectoryIds: knownDirectoryIds.filter((id) => !expandedDirectoryIds?.has(id)),
          });
        } else if (knownDirectoryIds.length > 0) {
          expandedDirectoryIds = expandedIdsFromState();
        }
        hydrated = true;
        if (localRevision > 0) persistExpandedIds();
      })
      .finally(() => {
        hydrationTask = undefined;
      });
    return hydrationTask;
  };

  store = createStore<WorkspaceDirectoryState>((set) => ({
    collapsedDirectoryIds: [],
    reconcileDirectoryIds: (ids, newlyAddedIds) => {
      knownDirectoryIds = ids;
      let nextCollapsedDirectoryIds: readonly string[] = [];
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
        if (hydrated && expandedDirectoryIds) {
          nextCollapsedDirectoryIds = ids.filter((id) => !expandedDirectoryIds?.has(id));
          return {
            activeDirectoryId,
            draftDirectoryId,
            collapsedDirectoryIds: nextCollapsedDirectoryIds,
          };
        }
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

        nextCollapsedDirectoryIds = [...collapsedDirectoryIds];
        return {
          activeDirectoryId,
          draftDirectoryId,
          collapsedDirectoryIds: nextCollapsedDirectoryIds,
        };
      });
      if (hydrated && !expandedDirectoryIds) {
        const collapsed = new Set(nextCollapsedDirectoryIds);
        expandedDirectoryIds = new Set(ids.filter((id) => !collapsed.has(id)));
      }
    },
    discardDirectory: (id) => {
      set((state) => ({
        collapsedDirectoryIds: state.collapsedDirectoryIds.filter(
          (directoryId) => directoryId !== id,
        ),
        activeDirectoryId: state.activeDirectoryId === id ? undefined : state.activeDirectoryId,
        draftDirectoryId: state.draftDirectoryId === id ? undefined : state.draftDirectoryId,
      }));
      localRevision += 1;
      recordExpanded(id, false);
    },
    activateDirectory: (id) => set({ activeDirectoryId: id }),
    deactivateDirectory: () => set({ activeDirectoryId: undefined, draftDirectoryId: undefined }),
    revealDirectory: (id) => {
      set((state) => ({
        activeDirectoryId: id,
        collapsedDirectoryIds: state.collapsedDirectoryIds.filter(
          (directoryId) => directoryId !== id,
        ),
      }));
      localRevision += 1;
      recordExpanded(id, true);
    },
    setDirectoryCollapsed: (id, collapsed) => {
      let changed = false;
      set((state) => {
        const currentlyCollapsed = state.collapsedDirectoryIds.includes(id);
        if (currentlyCollapsed === collapsed) return state;
        changed = true;
        return {
          collapsedDirectoryIds: collapsed
            ? [...state.collapsedDirectoryIds, id]
            : state.collapsedDirectoryIds.filter((directoryId) => directoryId !== id),
        };
      });
      if (!changed) return;
      localRevision += 1;
      recordExpanded(id, !collapsed);
    },
    toggleDirectory: (id) => {
      let expanded = false;
      set((state) => {
        expanded = state.collapsedDirectoryIds.includes(id);
        return {
          collapsedDirectoryIds: expanded
            ? state.collapsedDirectoryIds.filter((directoryId) => directoryId !== id)
            : [...state.collapsedDirectoryIds, id],
        };
      });
      localRevision += 1;
      recordExpanded(id, expanded);
    },
    beginNewThread: (id) => {
      set((state) => ({
        activeDirectoryId: id,
        draftDirectoryId: id,
        collapsedDirectoryIds: state.collapsedDirectoryIds.filter(
          (directoryId) => directoryId !== id,
        ),
      }));
      localRevision += 1;
      recordExpanded(id, true);
    },
    destroyNewThread: () => set({ draftDirectoryId: undefined }),
  }));
  return { store, hydrate };
}

export interface WorkspaceDirectoryStoreInstallation {
  readonly store: StoreApi<WorkspaceDirectoryState>;
  readonly port: WorkbenchWorkspaceDirectoryStorePort;
  hydrate(): Promise<void>;
}

/** Create application-owned workspace selection state for one Workbench installation. */
export function createWorkspaceDirectoryStoreInstallation(
  settings?: WorkbenchSettingsPort,
): WorkspaceDirectoryStoreInstallation {
  const directoryStore = createWorkspaceDirectoryStore(settings);
  const store = directoryStore.store;
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
  return Object.freeze({ store, port, hydrate: directoryStore.hydrate });
}
