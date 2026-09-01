import type { RightWorkspaceDraftPersistencePort } from "./right-workspace";
import type { ThreadScrollPersistencePort } from "./workbench";

export interface WorkbenchSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type WorkbenchSessionStorageResolver = () => WorkbenchSessionStorage | undefined;
export type WorkbenchDraftLegacyKeyResolver = (logicalKey: string) => readonly string[];

const LEGACY_THREAD_SCROLL_STORAGE_KEY = "workbench.thread-scroll-positions.v1";
const THREAD_SCROLL_STORAGE_PREFIX = "workbench:thread-scroll-positions:v2";
const DRAFT_STORAGE_PREFIX = "workbench:workspace-drafts:v1";

const defaultLegacyDraftKeys: WorkbenchDraftLegacyKeyResolver = (logicalKey) =>
  Object.freeze([logicalKey]);

function resolveBrowserSessionStorage(): WorkbenchSessionStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Browser persistence for logical drafts, isolated by one application installation id. */
export function createWorkbenchDraftPersistence(
  namespace: string,
  resolveStorage: WorkbenchSessionStorageResolver = resolveBrowserSessionStorage,
  resolveLegacyKeys: WorkbenchDraftLegacyKeyResolver = defaultLegacyDraftKeys,
): RightWorkspaceDraftPersistencePort {
  const normalizedNamespace = namespace.trim();
  if (!normalizedNamespace) throw new Error("Workspace draft persistence namespace is required");
  const storageKey = (logicalKey: string) =>
    `${DRAFT_STORAGE_PREFIX}:${encodeURIComponent(normalizedNamespace)}:${logicalKey}`;

  return Object.freeze({
    getItem(logicalKey: string): string | null {
      const storage = resolveStorage();
      if (!storage) return null;
      try {
        const installedKey = storageKey(logicalKey);
        const current = storage.getItem(installedKey);
        if (current !== null) return current;

        const legacyKeys = resolveLegacyKeys(logicalKey);
        for (const legacyKey of legacyKeys) {
          const legacy = storage.getItem(legacyKey);
          if (legacy === null) continue;
          storage.setItem(installedKey, legacy);
          for (const migratedKey of legacyKeys) storage.removeItem(migratedKey);
          return legacy;
        }
      } catch {
        // Draft persistence is best effort; the installation-local store remains authoritative.
      }
      return null;
    },
    setItem(logicalKey: string, value: string): void {
      const storage = resolveStorage();
      if (!storage) return;
      try {
        storage.setItem(storageKey(logicalKey), value);
        for (const legacyKey of resolveLegacyKeys(logicalKey)) storage.removeItem(legacyKey);
      } catch {
        // Draft persistence is best effort; the installation-local store keeps the value.
      }
    },
    removeItem(logicalKey: string): void {
      const storage = resolveStorage();
      if (!storage) return;
      try {
        storage.removeItem(storageKey(logicalKey));
        for (const legacyKey of resolveLegacyKeys(logicalKey)) storage.removeItem(legacyKey);
      } catch {
        // Draft persistence is best effort; the installation-local store still clears the value.
      }
    },
  });
}

/** Browser persistence for thread scroll state, isolated by one application installation id. */
export function createWorkbenchThreadScrollPersistence(
  namespace: string,
  resolveStorage: WorkbenchSessionStorageResolver = resolveBrowserSessionStorage,
): ThreadScrollPersistencePort {
  const normalizedNamespace = namespace.trim();
  if (!normalizedNamespace) throw new Error("Thread scroll persistence namespace is required");
  const storageKey = `${THREAD_SCROLL_STORAGE_PREFIX}:${encodeURIComponent(normalizedNamespace)}`;
  return Object.freeze({
    read(): string | null {
      const storage = resolveStorage();
      if (!storage) return null;
      try {
        const current = storage.getItem(storageKey);
        if (current !== null) return current;
        const legacy = storage.getItem(LEGACY_THREAD_SCROLL_STORAGE_KEY);
        if (legacy === null) return null;
        storage.setItem(storageKey, legacy);
        storage.removeItem(LEGACY_THREAD_SCROLL_STORAGE_KEY);
        return legacy;
      } catch {
        return null;
      }
    },
    write(serialized: string): void {
      const storage = resolveStorage();
      if (!storage) return;
      try {
        storage.setItem(storageKey, serialized);
        storage.removeItem(LEGACY_THREAD_SCROLL_STORAGE_KEY);
      } catch {
        // Scroll persistence is optional; Shell keeps its installation-local cache.
      }
    },
  });
}
