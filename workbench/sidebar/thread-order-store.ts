"use client";

import { create } from "zustand";

import {
  loadWorkbenchSettingsPreferences,
  updateWorkbenchSettingsPreferences,
} from "@/services/workbench-settings-service";

interface ThreadOrderState {
  readonly manualOrderByScope: Readonly<Record<string, readonly string[]>>;
  setManualOrder(scope: string, threadIds: readonly string[]): void;
}

let hydrationTask: Promise<void> | undefined;
let hydrated = false;
let localRevision = 0;
let persistenceTail: Promise<void> = Promise.resolve();

function mutableOrders(
  orders: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(orders).map(([scope, threadIds]) => [scope, [...threadIds]]),
  );
}

function persistOrders(orders: Readonly<Record<string, readonly string[]>>): void {
  const localOrders = mutableOrders(orders);
  const operation = async () => {
    const preferences = await loadWorkbenchSettingsPreferences();
    await updateWorkbenchSettingsPreferences({
      sidebarThreadOrderByScope: hydrated
        ? localOrders
        : {
            ...preferences.sidebarThreadOrderByScope,
            ...localOrders,
          },
    });
  };
  const result = persistenceTail.then(operation, operation);
  persistenceTail = result.catch(() => undefined);
  void result.catch((error) =>
    console.error("[workbench] failed to persist sidebar conversation order", error),
  );
}

export const useThreadOrderStore = create<ThreadOrderState>((set) => ({
  manualOrderByScope: {},
  setManualOrder: (scope, threadIds) => {
    localRevision += 1;
    let nextOrders: Readonly<Record<string, readonly string[]>> = {};
    set((state) => {
      nextOrders = {
        ...state.manualOrderByScope,
        [scope]: [...threadIds],
      };
      return { manualOrderByScope: nextOrders };
    });
    persistOrders(nextOrders);
  },
}));

export function hydrateThreadOrderStore(): Promise<void> {
  if (hydrated) return Promise.resolve();
  hydrationTask ??= loadWorkbenchSettingsPreferences()
    .then((preferences) => {
      const persistedOrders = preferences.sidebarThreadOrderByScope ?? {};
      useThreadOrderStore.setState((state) => ({
        manualOrderByScope: {
          ...mutableOrders(persistedOrders),
          ...(localRevision === 0 ? {} : state.manualOrderByScope),
        },
      }));
      hydrated = true;
    })
    .finally(() => {
      hydrationTask = undefined;
    });
  return hydrationTask;
}
