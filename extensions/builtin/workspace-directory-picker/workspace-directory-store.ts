import { create } from "zustand";

export interface WorkspaceDirectoryHandle {
  readonly name: string;
}

export interface WorkspaceDirectory {
  id: string;
  name: string;
  handle?: WorkspaceDirectoryHandle;
}

interface WorkspaceDirectoryState {
  directories: readonly WorkspaceDirectory[];
  activeDirectoryId?: string;
  draftDirectoryId?: string;
  addDirectory(directory: WorkspaceDirectory): void;
  activateDirectory(id: string): void;
  destroyNewThread(): void;
}

export const useWorkspaceDirectoryStore = create<WorkspaceDirectoryState>((set) => ({
  directories: [],
  addDirectory: (directory) =>
    set((state) => {
      const existing = state.directories.find((item) => item.name === directory.name);
      if (existing) {
        return {
          activeDirectoryId: existing.id,
          draftDirectoryId: existing.id,
        };
      }

      return {
        directories: [...state.directories, directory],
        activeDirectoryId: directory.id,
        draftDirectoryId: directory.id,
      };
    }),
  activateDirectory: (id) => set({ activeDirectoryId: id }),
  destroyNewThread: () => set({ draftDirectoryId: undefined }),
}));
