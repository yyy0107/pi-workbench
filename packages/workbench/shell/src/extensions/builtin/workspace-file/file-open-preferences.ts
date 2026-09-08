import { createStore } from "zustand/vanilla";

import type { WorkbenchSettingsPort } from "@workbench/shell/settings";

export const FILE_OPEN_PREFERENCES = Symbol("workbench.file-open-preferences");

interface FileOpenPreferences {
  appIds: Readonly<Record<string, string>>;
  hydrated: boolean;
  hydrate(): Promise<void>;
  remember(fileType: string, appId: string): Promise<void>;
}

export function createFileOpenPreferences(settings: WorkbenchSettingsPort) {
  let disposed = false;
  let hydration: Promise<void> | undefined;
  let pending = Promise.resolve();
  const store = createStore<FileOpenPreferences>((set, get) => ({
    appIds: {},
    hydrated: false,
    hydrate() {
      if (disposed || get().hydrated) return Promise.resolve();
      hydration ??= settings
        .load()
        .then((preferences) => {
          if (!disposed) set({ appIds: preferences.fileOpenApps ?? {}, hydrated: true });
        })
        .finally(() => {
          hydration = undefined;
        });
      return hydration;
    },
    remember(fileType, appId) {
      const write = pending.then(async () => {
        await get().hydrate();
        if (disposed || get().appIds[fileType] === appId) return;
        const appIds = { ...get().appIds, [fileType]: appId };
        await settings.update({ fileOpenApps: appIds });
        if (!disposed) set({ appIds });
      });
      pending = write.catch(() => {});
      return write;
    },
  }));
  return Object.assign(store, {
    dispose: () => {
      disposed = true;
    },
  });
}
