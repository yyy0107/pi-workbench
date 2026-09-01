"use client";

import { useEffect } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

import { useWorkbenchSettingsResource, type WorkbenchSettingsPort } from "../settings";

export interface ThreadOrderState {
  readonly manualOrderByScope: Readonly<Record<string, readonly string[]>>;
  setManualOrder(scope: string, threadIds: readonly string[]): void;
  hydrate(): Promise<void>;
}

const THREAD_ORDER_STORE_RESOURCE = Symbol("workbench.thread-order-store");

function mutableOrders(
  orders: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(orders).map(([scope, threadIds]) => [scope, [...threadIds]]),
  );
}

export function createThreadOrderStore(
  settings: WorkbenchSettingsPort,
): StoreApi<ThreadOrderState> {
  let hydrationTask: Promise<void> | undefined;
  let hydrated = false;
  let localRevision = 0;
  let persistenceTail: Promise<void> = Promise.resolve();
  let store: StoreApi<ThreadOrderState>;

  const persistOrders = (orders: Readonly<Record<string, readonly string[]>>) => {
    const localOrders = mutableOrders(orders);
    const operation = async () => {
      const preferences = await settings.load();
      await settings.update({
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
  };

  const hydrate = (): Promise<void> => {
    if (hydrated) return Promise.resolve();
    if (hydrationTask) return hydrationTask;
    hydrationTask = settings
      .load()
      .then((preferences) => {
        const persistedOrders = preferences.sidebarThreadOrderByScope ?? {};
        store.setState((state) => ({
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
  };

  store = createStore<ThreadOrderState>((set) => ({
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
    hydrate,
  }));
  return store;
}

function useInstalledThreadOrderStore(): StoreApi<ThreadOrderState> {
  return useWorkbenchSettingsResource(THREAD_ORDER_STORE_RESOURCE, createThreadOrderStore);
}

export function useThreadOrderStore<T>(selector: (state: ThreadOrderState) => T): T {
  return useStore(useInstalledThreadOrderStore(), selector);
}

export function useHydrateThreadOrderStore(): void {
  const hydrate = useThreadOrderStore((state) => state.hydrate);
  useEffect(() => {
    void hydrate().catch((error) =>
      console.error("[workbench] failed to restore sidebar conversation order", error),
    );
  }, [hydrate]);
}
