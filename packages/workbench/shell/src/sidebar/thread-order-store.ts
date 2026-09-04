"use client";

import { useEffect } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

import { useWorkbenchSettingsResource, type WorkbenchSettingsPort } from "../settings";

export interface ThreadOrderState {
  readonly manualOrderByScope: Readonly<Record<string, readonly string[]>>;
  setManualOrder(scope: string, threadIds: readonly string[]): Promise<void>;
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
  const scopeRevisions = new Map<string, number>();
  const confirmedOrders = new Map<string, readonly string[] | undefined>();
  let store: StoreApi<ThreadOrderState>;

  const persistOrder = (scope: string, threadIds: readonly string[], revision: number) => {
    const operation = async () => {
      const preferences = await settings.load();
      confirmedOrders.set(scope, preferences.sidebarThreadOrderByScope?.[scope]);
      await settings.update({
        sidebarThreadOrderByScope: {
          ...preferences.sidebarThreadOrderByScope,
          [scope]: [...threadIds],
        },
      });
      confirmedOrders.set(scope, [...threadIds]);
    };
    const result = persistenceTail.then(operation).catch((error) => {
      if (scopeRevisions.get(scope) === revision) {
        store.setState((state) => {
          const orders = { ...state.manualOrderByScope };
          const confirmed = confirmedOrders.get(scope);
          if (confirmed) orders[scope] = [...confirmed];
          else delete orders[scope];
          return { manualOrderByScope: orders };
        });
      }
      throw error;
    });
    persistenceTail = result.catch(() => undefined);
    return result;
  };

  const hydrate = (): Promise<void> => {
    if (hydrated) return Promise.resolve();
    if (hydrationTask) return hydrationTask;
    hydrationTask = settings
      .load()
      .then((preferences) => {
        const persistedOrders = preferences.sidebarThreadOrderByScope ?? {};
        for (const [scope, order] of Object.entries(persistedOrders)) {
          if (!confirmedOrders.has(scope)) confirmedOrders.set(scope, [...order]);
        }
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
      const revision = (scopeRevisions.get(scope) ?? 0) + 1;
      scopeRevisions.set(scope, revision);
      set((state) => ({
        manualOrderByScope: {
          ...state.manualOrderByScope,
          [scope]: [...threadIds],
        },
      }));
      return persistOrder(scope, [...threadIds], revision);
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
