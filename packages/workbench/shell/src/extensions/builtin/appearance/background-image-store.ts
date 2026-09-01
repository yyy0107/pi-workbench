"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

import { useWorkbenchSettingsResource, type WorkbenchSettingsPort } from "../../../settings";

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

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== "string") {
        reject(new TypeError("Background image could not be encoded"));
        return;
      }
      resolve(value.slice(value.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Background image could not be read"));
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(data: string, mimeType: string): Blob {
  const binary = window.atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

function readySnapshot(image: StoredBackgroundImage): BackgroundImageSnapshot {
  return {
    status: "ready",
    url: URL.createObjectURL(image.blob),
    name: image.name,
    error: null,
  };
}

export interface BackgroundImageStore {
  subscribe(listener: Listener): () => void;
  getSnapshot(): BackgroundImageSnapshot;
  getServerSnapshot(): BackgroundImageSnapshot;
  hydrate(): Promise<void>;
  setFile(file: File): Promise<void>;
  clear(): Promise<void>;
  dispose(): void;
}

const BACKGROUND_IMAGE_STORE_RESOURCE = Symbol("workbench.background-image-store");

export function createBackgroundImageStore(settings: WorkbenchSettingsPort): BackgroundImageStore {
  let snapshot: BackgroundImageSnapshot = INITIAL_SNAPSHOT;
  let hydrated = false;
  let closed = false;
  const listeners = new Set<Listener>();

  const emit = (nextSnapshot: BackgroundImageSnapshot) => {
    if (closed) {
      if (nextSnapshot.url) URL.revokeObjectURL(nextSnapshot.url);
      return;
    }
    const previousUrl = snapshot.url;
    snapshot = Object.freeze(nextSnapshot);
    for (const listener of listeners) listener();
    if (previousUrl && previousUrl !== nextSnapshot.url) URL.revokeObjectURL(previousUrl);
  };

  return Object.freeze({
    subscribe(listener: Listener): () => void {
      if (closed) return () => {};
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
      if (closed || hydrated || typeof window === "undefined") return;
      hydrated = true;
      emit({ ...snapshot, status: "loading", error: null });

      try {
        const legacy = await readStoredImage().catch(() => null);
        if (closed) return;
        const preferences = await settings.load();
        if (closed) return;
        if (preferences.backgroundImage) {
          emit(
            readySnapshot({
              blob: base64ToBlob(
                preferences.backgroundImage.data,
                preferences.backgroundImage.mimeType,
              ),
              name: preferences.backgroundImage.name,
            }),
          );
          if (legacy && !closed) await writeStoredImage(null).catch(() => undefined);
        } else if (legacy) {
          if (closed) return;
          const data = await blobToBase64(legacy.blob);
          if (closed) return;
          await settings.update({
            backgroundImage: {
              name: legacy.name,
              mimeType: legacy.blob.type || "image/*",
              data,
            },
          });
          if (closed) return;
          await writeStoredImage(null).catch(() => undefined);
          if (closed) return;
          emit(readySnapshot(legacy));
        } else {
          emit(INITIAL_SNAPSHOT);
        }
      } catch {
        emit({ status: "error", url: null, name: null, error: "storage" });
      }
    },
    async setFile(file: File): Promise<void> {
      if (closed) return;
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
        const data = await blobToBase64(file);
        if (closed) return;
        await settings.update({
          backgroundImage: {
            name: file.name,
            mimeType: file.type,
            data,
          },
        });
        if (closed) return;
        await writeStoredImage(null).catch(() => undefined);
        if (closed) return;
        emit(readySnapshot({ blob: file, name: file.name }));
      } catch {
        emit({ ...snapshot, status: "error", error: "storage" });
      }
    },
    async clear(): Promise<void> {
      if (closed) return;
      emit({ ...snapshot, status: "loading", error: null });
      try {
        await settings.update({ backgroundImage: null });
        if (closed) return;
        await writeStoredImage(null).catch(() => undefined);
        if (closed) return;
        emit(INITIAL_SNAPSHOT);
      } catch {
        emit({ ...snapshot, status: "error", error: "storage" });
      }
    },
    dispose(): void {
      if (closed) return;
      closed = true;
      listeners.clear();
      if (snapshot.url) URL.revokeObjectURL(snapshot.url);
      snapshot = INITIAL_SNAPSHOT;
    },
  });
}

function useBackgroundImageStore(): BackgroundImageStore {
  return useWorkbenchSettingsResource(BACKGROUND_IMAGE_STORE_RESOURCE, createBackgroundImageStore);
}

export function useBackgroundImage(): BackgroundImageSnapshot {
  const store = useBackgroundImageStore();
  const currentSnapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  useEffect(() => {
    void store.hydrate();
  }, [store]);

  return currentSnapshot;
}

export function useBackgroundImageController(): Readonly<{
  setFile(file: File): Promise<void>;
  clear(): Promise<void>;
}> {
  const store = useBackgroundImageStore();
  return useMemo(
    () => ({
      setFile: store.setFile,
      clear: store.clear,
    }),
    [store],
  );
}
