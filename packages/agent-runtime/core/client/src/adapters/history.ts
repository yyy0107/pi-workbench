export const WORKBENCH_STORAGE_PREFIX = "workbench-ui:";

export interface WorkbenchAsyncStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const memoryFallback = new Map<string, string>();

function getBrowserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export const workbenchBrowserStorage: WorkbenchAsyncStorage = {
  async getItem(key) {
    try {
      return getBrowserStorage()?.getItem(key) ?? memoryFallback.get(key) ?? null;
    } catch {
      return memoryFallback.get(key) ?? null;
    }
  },
  async setItem(key, value) {
    memoryFallback.set(key, value);

    try {
      getBrowserStorage()?.setItem(key, value);
    } catch {
      // The in-memory fallback keeps the current session usable when storage
      // is blocked (for example in a strict private browsing mode).
    }
  },
  async removeItem(key) {
    memoryFallback.delete(key);

    try {
      getBrowserStorage()?.removeItem(key);
    } catch {
      // See setItem: the adapter intentionally degrades to session memory.
    }
  },
};
