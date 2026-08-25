"use client";

import { useMemo, useSyncExternalStore } from "react";

import type { WorkbenchExtension } from "@/platform/extensions";

import { installableComponentExtensions } from "./installable-extensions";

export interface InstallableComponentExtensionState {
  readonly extension: WorkbenchExtension;
  readonly installed: boolean;
}

const STORAGE_KEY = "workbench.component-extensions.disabled.v1";
const EMPTY_DISABLED_IDS = Object.freeze([]) as readonly string[];
const INSTALLABLE_IDS: ReadonlySet<string> = new Set(
  installableComponentExtensions.map((extension) => extension.id),
);
const DEFAULT_CATALOG_STATE = Object.freeze(
  installableComponentExtensions.map((extension) => Object.freeze({ extension, installed: true })),
) as readonly InstallableComponentExtensionState[];
const listeners = new Set<() => void>();

let volatileStorageValue: string | null = null;
let volatileStorageActive = false;
let cachedStorageValue: string | null | undefined;
let cachedDisabledIds = EMPTY_DISABLED_IDS;
let cachedCatalogDisabledIds = EMPTY_DISABLED_IDS;
let cachedCatalogState = DEFAULT_CATALOG_STATE;

function readStorageValue(): string | null {
  if (typeof window === "undefined") return null;
  if (volatileStorageActive) return volatileStorageValue;

  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return volatileStorageValue;
  }
}

function parseDisabledIds(value: string | null): readonly string[] {
  if (!value) return EMPTY_DISABLED_IDS;

  try {
    const candidate: unknown = JSON.parse(value);
    if (!Array.isArray(candidate)) return EMPTY_DISABLED_IDS;

    const disabledIds = Array.from(
      new Set(
        candidate.filter(
          (extensionId): extensionId is string =>
            typeof extensionId === "string" && INSTALLABLE_IDS.has(extensionId),
        ),
      ),
    ).sort();
    return disabledIds.length > 0 ? Object.freeze(disabledIds) : EMPTY_DISABLED_IDS;
  } catch {
    return EMPTY_DISABLED_IDS;
  }
}

function getDisabledIdsSnapshot(): readonly string[] {
  const storageValue = readStorageValue();
  if (storageValue === cachedStorageValue) return cachedDisabledIds;

  cachedStorageValue = storageValue;
  cachedDisabledIds = parseDisabledIds(storageValue);
  return cachedDisabledIds;
}

function getCatalogStateSnapshot(): readonly InstallableComponentExtensionState[] {
  const disabledIds = getDisabledIdsSnapshot();
  if (disabledIds === cachedCatalogDisabledIds) return cachedCatalogState;

  const disabled = new Set(disabledIds);
  cachedCatalogDisabledIds = disabledIds;
  cachedCatalogState = Object.freeze(
    installableComponentExtensions.map((extension) =>
      Object.freeze({ extension, installed: !disabled.has(extension.id) }),
    ),
  );
  return cachedCatalogState;
}

function emitChange(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    volatileStorageActive = false;
    cachedStorageValue = undefined;
    listener();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function writeDisabledIds(disabledIds: ReadonlySet<string>): void {
  const normalizedIds = Array.from(disabledIds)
    .filter((extensionId) => INSTALLABLE_IDS.has(extensionId))
    .sort();
  const storageValue = normalizedIds.length > 0 ? JSON.stringify(normalizedIds) : null;

  volatileStorageValue = storageValue;
  try {
    if (storageValue === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, storageValue);
    volatileStorageActive = false;
  } catch {
    // localStorage 不可用时仍维持当前页面内的安装状态。
    volatileStorageActive = true;
  }

  cachedStorageValue = undefined;
  emitChange();
}

export function setComponentExtensionInstalled(extensionId: string, installed: boolean): void {
  if (!INSTALLABLE_IDS.has(extensionId)) {
    throw new Error(`Unknown installable component extension "${extensionId}"`);
  }

  const disabledIds = new Set(getDisabledIdsSnapshot());
  if (installed) disabledIds.delete(extensionId);
  else disabledIds.add(extensionId);
  writeDisabledIds(disabledIds);
}

export function useInstallableComponentExtensions(): readonly InstallableComponentExtensionState[] {
  return useSyncExternalStore(subscribe, getCatalogStateSnapshot, () => DEFAULT_CATALOG_STATE);
}

export function useInstalledComponentExtensions(): readonly WorkbenchExtension[] {
  const catalog = useInstallableComponentExtensions();
  return useMemo(
    () => catalog.filter(({ installed }) => installed).map(({ extension }) => extension),
    [catalog],
  );
}
