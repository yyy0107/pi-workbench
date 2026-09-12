"use client";

import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";

import type { HostObservable } from "@workbench/agent-runtime-core";

export type SnapshotSelectorHook<T> = <Selection>(
  selector: (snapshot: T) => Selection,
  isEqual?: (left: Selection, right: Selection) => boolean,
) => Selection;

/** Bind one stable observable face to React's selector-aware external-store hook. */
export function bindSnapshotSelector<T>(source: HostObservable<T>): SnapshotSelectorHook<T> {
  const subscribe = (listener: () => void) => source.subscribe(listener);
  const getSnapshot = () => source.getSnapshot();

  return function useSnapshotSelector<Selection>(
    selector: (snapshot: T) => Selection,
    isEqual?: (left: Selection, right: Selection) => boolean,
  ): Selection {
    return useSyncExternalStoreWithSelector(subscribe, getSnapshot, getSnapshot, selector, isEqual);
  };
}

const selectorHooks = new WeakMap<object, SnapshotSelectorHook<unknown>>();

/** Reuse the bound hook for a host-owned observable so React never resubscribes by accident. */
export function useHostSnapshot<T, Selection>(
  source: HostObservable<T>,
  selector: (snapshot: T) => Selection,
  isEqual?: (left: Selection, right: Selection) => boolean,
): Selection {
  let useSelector = selectorHooks.get(source) as SnapshotSelectorHook<T> | undefined;
  if (!useSelector) {
    useSelector = bindSnapshotSelector(source);
    selectorHooks.set(source, useSelector as SnapshotSelectorHook<unknown>);
  }
  return useSelector(selector, isEqual);
}
