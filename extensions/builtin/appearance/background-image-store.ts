"use client";

import { useEffect, useSyncExternalStore } from "react";

const DATABASE_NAME = "workbench-appearance";
const DATABASE_VERSION = 1;
const STORE_NAME = "assets";
const BACKGROUND_IMAGE_KEY = "background-image";
const MAX_BACKGROUND_IMAGE_SIZE = 12 * 1024 * 1024;

export type BackgroundImageError = "unsupported" | "tooLarge" | "storage";

export interface BackgroundImageSnapshot {
  status: "idle" | "loading" | "ready" | "error";
  url: string | null;
  name: string | null;
  error: BackgroundImageError | null;
}

interface StoredBackgroundImage {
  blob: Blob;
  name: string;
}

type Listener = () => void;

const INITIAL_SNAPSHOT = Object.freeze({
  status: "idle",
  url: null,
  name: null,
  error: null,
} satisfies BackgroundImageSnapshot);

let snapshot: BackgroundImageSnapshot = INITIAL_SNAPSHOT;
let hydrated = false;
const listeners = new Set<Listener>();

function emit(nextSnapshot: BackgroundImageSnapshot): void {
  const previousUrl = snapshot.url;
  snapshot = Object.freeze(nextSnapshot);
  for (const listener of listeners) listener();
  if (previousUrl && previousUrl !== nextSnapshot.url) URL.revokeObjectURL(previousUrl);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open appearance storage"));
  });
}

async function readStoredImage(): Promise<StoredBackgroundImage | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(BACKGROUND_IMAGE_KEY);
      request.onsuccess = () => {
        const value: unknown = request.result;
        if (
          typeof value === "object" &&
          value !== null &&
          "blob" in value &&
          value.blob instanceof Blob &&
          "name" in value &&
          typeof value.name === "string"
        ) {
          resolve({ blob: value.blob, name: value.name });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to read background"));
    });
  } finally {
    database.close();
  }
}

async function writeStoredImage(image: StoredBackgroundImage | null): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      if (image) store.put(image, BACKGROUND_IMAGE_KEY);
      else store.delete(BACKGROUND_IMAGE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Unable to write background"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Background write was aborted"));
    });
  } finally {
    database.close();
  }
}

export const backgroundImageStore = Object.freeze({
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): BackgroundImageSnapshot {
    return snapshot;
  },
  getServerSnapshot(): BackgroundImageSnapshot {
    return INITIAL_SNAPSHOT;
  },
  async hydrate(): Promise<void> {
    if (hydrated || typeof window === "undefined") return;
    hydrated = true;
    emit({ ...snapshot, status: "loading", error: null });

    try {
      const stored = await readStoredImage();
      if (!stored) {
        emit(INITIAL_SNAPSHOT);
        return;
      }
      emit({
        status: "ready",
        url: URL.createObjectURL(stored.blob),
        name: stored.name,
        error: null,
      });
    } catch {
      emit({ status: "error", url: null, name: null, error: "storage" });
    }
  },
  async setFile(file: File): Promise<void> {
    if (!file.type.startsWith("image/")) {
      emit({ ...snapshot, status: "error", error: "unsupported" });
      return;
    }
    if (file.size > MAX_BACKGROUND_IMAGE_SIZE) {
      emit({ ...snapshot, status: "error", error: "tooLarge" });
      return;
    }

    emit({ ...snapshot, status: "loading", error: null });
    try {
      await writeStoredImage({ blob: file, name: file.name });
      emit({
        status: "ready",
        url: URL.createObjectURL(file),
        name: file.name,
        error: null,
      });
    } catch {
      emit({ ...snapshot, status: "error", error: "storage" });
    }
  },
  async clear(): Promise<void> {
    emit({ ...snapshot, status: "loading", error: null });
    try {
      await writeStoredImage(null);
      emit(INITIAL_SNAPSHOT);
    } catch {
      emit({ ...snapshot, status: "error", error: "storage" });
    }
  },
});

export function useBackgroundImage(): BackgroundImageSnapshot {
  const currentSnapshot = useSyncExternalStore(
    backgroundImageStore.subscribe,
    backgroundImageStore.getSnapshot,
    backgroundImageStore.getServerSnapshot,
  );

  useEffect(() => {
    void backgroundImageStore.hydrate();
  }, []);

  return currentSnapshot;
}
