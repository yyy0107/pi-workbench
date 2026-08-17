import { create } from "zustand";

const REMOVED_WORKSPACES_STORAGE_KEY = "pi-workbench:removed-workspaces";

function readRemovedWorkspaceIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const value = JSON.parse(window.localStorage.getItem(REMOVED_WORKSPACES_STORAGE_KEY) ?? "[]");
    return new Set(
      Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function writeRemovedWorkspaceIds(ids: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(REMOVED_WORKSPACES_STORAGE_KEY);
    else window.localStorage.setItem(REMOVED_WORKSPACES_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Workspace visibility preferences are best-effort when storage is unavailable.
  }
}

export interface WorkspaceDirectory {
  id: string;
  name: string;
  cwd: string;
}

interface WorkspaceDirectoryState {
  directories: readonly WorkspaceDirectory[];
  collapsedDirectoryIds: readonly string[];
  activeDirectoryId?: string;
  draftDirectoryId?: string;
  addDirectory(directory: WorkspaceDirectory): void;
  syncDirectory(directory: WorkspaceDirectory): void;
  syncDirectories(directories: readonly WorkspaceDirectory[]): void;
  removeDirectory(id: string): void;
  activateDirectory(id: string): void;
  revealDirectory(id: string): void;
  toggleDirectory(id: string): void;
  beginNewThread(id: string): void;
  destroyNewThread(): void;
}

export const useWorkspaceDirectoryStore = create<WorkspaceDirectoryState>((set) => ({
  directories: [],
  collapsedDirectoryIds: [],
  addDirectory: (directory) =>
    set((state) => {
      const removedWorkspaceIds = readRemovedWorkspaceIds();
      if (removedWorkspaceIds.delete(directory.id)) writeRemovedWorkspaceIds(removedWorkspaceIds);
      const existing = state.directories.find(
        (item) => item.id === directory.id || item.cwd === directory.cwd,
      );
      if (existing) {
        return {
          directories: [directory, ...state.directories.filter((item) => item.id !== existing.id)],
          activeDirectoryId: directory.id,
          draftDirectoryId: directory.id,
          collapsedDirectoryIds: state.collapsedDirectoryIds.filter(
            (directoryId) => directoryId !== existing.id && directoryId !== directory.id,
          ),
        };
      }

      return {
        directories: [directory, ...state.directories],
        activeDirectoryId: directory.id,
        draftDirectoryId: directory.id,
        collapsedDirectoryIds: state.collapsedDirectoryIds.filter(
          (directoryId) => directoryId !== directory.id,
        ),
      };
    }),
  syncDirectory: (directory) =>
    set((state) => {
      if (readRemovedWorkspaceIds().has(directory.id)) return state;
      const existingIndex = state.directories.findIndex(
        (item) => item.id === directory.id || item.cwd === directory.cwd,
      );
      if (existingIndex === -1) {
        return {
          directories: [...state.directories, directory],
          activeDirectoryId: state.activeDirectoryId ?? directory.id,
        };
      }

      const existing = state.directories[existingIndex];
      const directories = [...state.directories];
      directories[existingIndex] = { ...existing, ...directory };
      return {
        directories,
        activeDirectoryId:
          state.activeDirectoryId === existing.id ? directory.id : state.activeDirectoryId,
        draftDirectoryId:
          state.draftDirectoryId === existing.id ? directory.id : state.draftDirectoryId,
      };
    }),
  syncDirectories: (incomingDirectories) =>
    set((state) => {
      if (incomingDirectories.length === 0) return state;

      const removedWorkspaceIds = readRemovedWorkspaceIds();
      const directories = [...state.directories];
      const collapsedDirectoryIds = new Set(state.collapsedDirectoryIds);
      let activeDirectoryId = state.activeDirectoryId;
      let draftDirectoryId = state.draftDirectoryId;

      for (const directory of incomingDirectories) {
        if (removedWorkspaceIds.has(directory.id)) continue;
        const existingIndex = directories.findIndex(
          (item) => item.id === directory.id || item.cwd === directory.cwd,
        );
        if (existingIndex === -1) {
          directories.push(directory);
          if (!activeDirectoryId) activeDirectoryId = directory.id;
          else collapsedDirectoryIds.add(directory.id);
          continue;
        }

        const existing = directories[existingIndex];
        directories[existingIndex] = { ...existing, ...directory };
        if (activeDirectoryId === existing.id) activeDirectoryId = directory.id;
        if (draftDirectoryId === existing.id) draftDirectoryId = directory.id;
        if (existing.id !== directory.id && collapsedDirectoryIds.delete(existing.id)) {
          collapsedDirectoryIds.add(directory.id);
        }
      }

      if (activeDirectoryId) collapsedDirectoryIds.delete(activeDirectoryId);
      return {
        directories,
        collapsedDirectoryIds: [...collapsedDirectoryIds],
        activeDirectoryId,
        draftDirectoryId,
      };
    }),
  removeDirectory: (id) =>
    set((state) => {
      const removedWorkspaceIds = readRemovedWorkspaceIds();
      removedWorkspaceIds.add(id);
      writeRemovedWorkspaceIds(removedWorkspaceIds);
      const directories = state.directories.filter((directory) => directory.id !== id);
      return {
        directories,
        collapsedDirectoryIds: state.collapsedDirectoryIds.filter(
          (directoryId) => directoryId !== id,
        ),
        activeDirectoryId:
          state.activeDirectoryId === id ? directories[0]?.id : state.activeDirectoryId,
        draftDirectoryId: state.draftDirectoryId === id ? undefined : state.draftDirectoryId,
      };
    }),
  activateDirectory: (id) => set({ activeDirectoryId: id }),
  revealDirectory: (id) =>
    set((state) => ({
      activeDirectoryId: id,
      collapsedDirectoryIds: state.collapsedDirectoryIds.filter(
        (directoryId) => directoryId !== id,
      ),
    })),
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
